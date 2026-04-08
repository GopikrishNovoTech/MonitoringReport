/**
 * src/services/aiService.ts
 * Drop-in replacement for geminiService.ts
 *
 * All exported function signatures are IDENTICAL to geminiService.ts.
 * Components only need their import path changed — nothing else.
 *
 * All AI calls go to POST /api/ai on the Express server (server/index.js).
 * The Azure OpenAI key never touches the browser.
 */

// ─── Retry helper — mirrors original withRetry exactly ───────────────────────

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelay = 1000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const msg = String(error.message || '');
      const isRetryable =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('exhausted') ||
        msg.includes('high demand') ||
        error.status === 503 ||
        error.status === 429;

      if (isRetryable && i < maxRetries - 1) {
        const retryAfterSecs = error.retryAfter ?? 0;
        const delay = retryAfterSecs > 0
          ? retryAfterSecs * 1000
          : initialDelay * Math.pow(2, i);
        console.warn(`Azure AI busy (Attempt ${i + 1}/${maxRetries}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// ─── Core fetch → Express /api/ai ────────────────────────────────────────────

async function callApi(action: string, payload: object): Promise<any> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const err: any = new Error(body.error || `API error ${res.status}`);
    err.status = res.status;
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      if (ra) err.retryAfter = parseInt(ra, 10);
    }
    throw err;
  }

  const data = await res.json();
  return data.content;
}

// ─── Exported functions — identical signatures to geminiService.ts ────────────

export const generateGxPSentence = async (
  description: string, annotation: string, keywords: string,
  protocol: string, cmp: string, protocolNum: string, language: string
): Promise<any> => {
  return withRetry(async () => {
    const raw = await callApi('generateGxPSentence', {
      description, annotation, keywords, protocol, cmp, protocolNum, language,
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
};

export const mapNotesToChecklist = async (
  notes: string,
  checklist: { id: string; description: string }[],
  language: string
): Promise<any> => {
  return withRetry(async () => {
    const raw = await callApi('mapNotesToChecklist', { notes, checklist, language });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
};

export const performOCR = async (fileData: string, mimeType: string): Promise<string> => {
  return withRetry(async () => {
    const raw = await callApi('performOCR', { fileData, mimeType });
    return typeof raw === 'string' ? raw : (raw?.text ?? '');
  });
};

export const performAIPeerReview = async (
  report: string, description: string, protocol: string,
  cmp: string, annotated: string, language: string
): Promise<any> => {
  return withRetry(async () => {
    const raw = await callApi('performAIPeerReview', {
      report, description, protocol, cmp, annotated, language,
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
};

export const refineGxPWithClarification = async (
  sentence: string, clarification: string, suggestions: string, language: string
): Promise<any> => {
  return withRetry(async () => {
    const raw = await callApi('refineGxPWithClarification', {
      sentence, clarification, suggestions, language,
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
};

export const generateFollowUpLetter = async (
  findings: any[], protocolNumber: string,
  sponsorName: string, craName: string, language: string
): Promise<any> => {
  return withRetry(async () => {
    const raw = await callApi('generateFollowUpLetter', {
      findings, protocolNumber, sponsorName, craName, language,
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
};
