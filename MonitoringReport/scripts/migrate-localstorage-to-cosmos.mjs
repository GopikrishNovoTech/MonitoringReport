/**
 * scripts/migrate-localstorage-to-cosmos.mjs
 * One-time migration of IMV reports from localStorage backup into Cosmos DB.
 *
 * Step 1 — Export from old app (run in browser DevTools console):
 *   const data = localStorage.getItem('aide_imv_reports');
 *   const a = Object.assign(document.createElement('a'), {
 *     href: URL.createObjectURL(new Blob([data], {type:'application/json'})),
 *     download: 'imv_reports_backup.json'
 *   });
 *   document.body.appendChild(a); a.click(); a.remove();
 *
 * Step 2 — Import into Cosmos (run from repo root in Cloud Shell):
 *   COSMOS_ENDPOINT=https://... COSMOS_KEY=... node scripts/migrate-localstorage-to-cosmos.mjs
 */

import { CosmosClient } from '@azure/cosmos';
import { readFileSync }  from 'fs';

const ENDPOINT  = process.env.COSMOS_ENDPOINT;
const KEY       = process.env.COSMOS_KEY;
const DATABASE  = process.env.COSMOS_DATABASE  || 'aide-db';
const CONTAINER = process.env.COSMOS_CONTAINER || 'imv-reports';
const BACKUP    = process.env.BACKUP_FILE      || './imv_reports_backup.json';

if (!ENDPOINT || !KEY) {
  console.error('Set COSMOS_ENDPOINT and COSMOS_KEY before running.');
  process.exit(1);
}

const client    = new CosmosClient({ endpoint: ENDPOINT, key: KEY });
const container = client.database(DATABASE).container(CONTAINER);
const reports   = JSON.parse(readFileSync(BACKUP, 'utf8'));

console.log(`Found ${reports.length} reports to migrate.`);
let success = 0, failed = 0;

for (const report of reports) {
  try {
    await container.items.upsert(report);
    console.log(`  Imported: ${report.id}`);
    success++;
  } catch (err) {
    console.error(`  FAILED:   ${report.id} — ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. ${success} imported, ${failed} failed.`);
