/**
 * src/services/dbService.ts
 * Drop-in replacement for the localStorage-based dbService.ts
 *
 * Same filename. Same three exported functions. Same signatures.
 * No changes needed in any component that already imports from dbService.
 *
 * Calls route to POST /api/db on the Express server (server/index.js).
 * The Cosmos DB key never touches the browser.
 */

import { IMVReport } from '../types';

async function callDb(action: string, payload?: object): Promise<any> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `DB API error ${res.status}`);
  }
  return res.json();
}

export const saveIMVReport = async (report: IMVReport): Promise<void> => {
  await callDb('upsertIMVReport', report);
};

export const getAllIMVReports = async (): Promise<IMVReport[]> => {
  const data = await callDb('getAllIMVReports');
  return data.reports ?? [];
};

export const getIMVReportById = async (id: string): Promise<IMVReport | undefined> => {
  const data = await callDb('getIMVReportById', { id });
  return data.report ?? undefined;
};
