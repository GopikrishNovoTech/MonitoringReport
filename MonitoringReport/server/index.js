/**
 * server/index.js
 * ─────────────────────────────────────────────────────────────────
 * Azure App Service entry point — Node.js 20 ESM
 *
 * Responsibilities:
 *   1.  Serves the Vite-built React SPA from ../dist/
 *   2.  POST /api/ai  — Azure OpenAI proxy (key stays server-side)
 *   3.  POST /api/db  — Cosmos DB CRUD    (key stays server-side)
 *
 * Azure App Service startup command (set once in Configuration):
 *   node server/index.js
 *
 * Required Application Settings in Azure App Service:
 *   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT
 *   COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER
 */

import express    from 'express';
import path       from 'path';
import { fileURLToPath } from 'url';
import { AzureOpenAI }  from '@azure/openai';
import { CosmosClient } from '@azure/cosmos';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ─── Azure clients (initialised once, reused across requests) ─────────────────

const openai = new AzureOpenAI({
  endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
  apiKey:     process.env.AZURE_OPENAI_KEY,
  apiVersion: '2024-08-01-preview',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
});

const cosmos = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key:      process.env.COSMOS_KEY,
});
const imvContainer = cosmos
  .database(process.env.COSMOS_DATABASE  || 'aide-db')
  .container(process.env.COSMOS_CONTAINER || 'imv-reports');

// ─── Prompt builders (all prompts live server-side only) ──────────────────────

const prompts = {

  generateGxPSentence: (p) => ({
    system:
      `You are an expert GxP clinical monitoring report writer (ICH E6(R3) GCP). ` +
      `Write one professional, audit-ready sentence for the checklist item. ` +
      `Respond in ${p.language}. Return ONLY valid JSON — no markdown, no code fences. ` +
      `Schema: { "text": string, "status": "Pass"|"Fail", ` +
      `"findings": [{ "pdWording": string, "fuiWording": string }] } ` +
      `findings is [] when status is Pass.`,
    user:
      `Checklist requirement: ${p.description}\n` +
      `Annotation guide: ${p.annotation}\n` +
      `Field notes / keywords: ${p.keywords}\n` +
      `Protocol excerpt: ${(p.protocol || '').substring(0, 4000)}\n` +
      `CMP excerpt: ${(p.cmp || '').substring(0, 2000)}\n` +
      `Protocol number: ${p.protocolNum}`,
  }),

  mapNotesToChecklist: (p) => ({
    system:
      `You are a GxP clinical monitoring expert. ` +
      `Map the site monitoring notes to the checklist item IDs provided. ` +
      `Return ONLY valid JSON — a flat object where keys are checklist IDs and values are ` +
      `the relevant note excerpt, or "Matching information not found". No markdown.`,
    user:
      `Checklist items:\n${JSON.stringify(p.checklist, null, 2)}\n\n` +
      `Site notes:\n${(p.notes || '').substring(0, 8000)}\n\n` +
      `Language: ${p.language}`,
  }),

  performAIPeerReview: (p) => ({
    system:
      `You are a senior GxP peer reviewer (ICH E6(R3)). ` +
      `Review the report sentence for quality, completeness and GxP compliance. ` +
      `Respond in ${p.language}. Return ONLY valid JSON — no markdown. ` +
      `Schema: { "criticalThinking": string, "curiosityQuestion": string, ` +
      `"suggestedComments": string[], ` +
      `"protocolMatch": "Verified"|"Conflict"|"Ambiguous", "ichReference": string }`,
    user:
      `Report sentence: "${p.report}"\n` +
      `Checklist requirement: ${p.description}\n` +
      `Protocol: ${(p.protocol || '').substring(0, 3000)}\n` +
      `CMP: ${(p.cmp || '').substring(0, 1500)}\n` +
      `Annotated notes: ${(p.annotated || '').substring(0, 1500)}`,
  }),

  refineGxPWithClarification: (p) => ({
    system:
      `You are a GxP clinical writing expert. ` +
      `Refine the sentence using the author's clarification and peer suggestions. ` +
      `Respond in ${p.language}. Return ONLY valid JSON: { "text": string }. No markdown.`,
    user:
      `Original sentence: "${p.sentence}"\n` +
      `Author clarification: "${p.clarification}"\n` +
      `Peer suggestions: "${p.suggestions}"`,
  }),

  generateFollowUpLetter: (p) => ({
    system:
      `You are a clinical CRA expert. Write a formal GxP-compliant follow-up letter. ` +
      `Respond in ${p.language}. Return ONLY valid JSON: { "text": string }. ` +
      `Use \\n for line breaks. No markdown.`,
    user:
      `Protocol: ${p.protocolNumber}  Sponsor: ${p.sponsorName}  CRA: ${p.craName}\n` +
      `Findings:\n${JSON.stringify(p.findings, null, 2)}`,
  }),

};

// ─── POST /api/ai ─────────────────────────────────────────────────────────────

app.post('/api/ai', async (req, res) => {
  const { action, payload } = req.body || {};
  if (!action || !payload) {
    return res.status(400).json({ error: 'Body must contain { action, payload }' });
  }

  try {
    let content;

    if (action === 'performOCR') {
      const result = await openai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an OCR engine. Extract ALL text from the image exactly as it appears. Return only the raw extracted text.',
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${payload.mimeType};base64,${payload.fileData}` } },
              { type: 'text', text: 'Extract all text.' },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      });
      content = result.choices[0]?.message?.content ?? '';

    } else {
      const builder = prompts[action];
      if (!builder) return res.status(400).json({ error: `Unknown action: ${action}` });

      const { system, user } = builder(payload);
      const result = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
      content = result.choices[0]?.message?.content ?? '{}';
    }

    res.json({ content });

  } catch (err) {
    console.error(`[/api/ai] ${action} failed:`, err.message);
    const status = err.status ?? 500;
    if (status === 429) res.set('retry-after', err.headers?.['retry-after'] ?? '5');
    res.status(status).json({ error: err.message || 'Azure OpenAI error' });
  }
});

// ─── POST /api/db ─────────────────────────────────────────────────────────────

app.post('/api/db', async (req, res) => {
  const { action, payload } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Body must contain { action }' });

  try {
    if (action === 'upsertIMVReport') {
      if (!payload?.id) return res.status(400).json({ error: 'payload.id required' });
      const { resource } = await imvContainer.items.upsert(payload);
      return res.json({ success: true, id: resource?.id });
    }
    if (action === 'getAllIMVReports') {
      const { resources } = await imvContainer.items
        .query({ query: 'SELECT * FROM c ORDER BY c.openedAt DESC' })
        .fetchAll();
      return res.json({ reports: resources });
    }
    if (action === 'getIMVReportById') {
      if (!payload?.id) return res.status(400).json({ error: 'payload.id required' });
      try {
        const { resource } = await imvContainer.item(payload.id, payload.id).read();
        return res.json({ report: resource ?? null });
      } catch (e) {
        if (e.code === 404) return res.json({ report: null });
        throw e;
      }
    }
    res.status(400).json({ error: `Unknown db action: ${action}` });

  } catch (err) {
    console.error(`[/api/db] ${action} failed:`, err.message);
    res.status(err.code ?? 500).json({ error: err.message || 'Cosmos DB error' });
  }
});

// ─── Serve React SPA — must be AFTER all /api routes ─────────────────────────

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`AIDE server running on port ${PORT}`);
});
