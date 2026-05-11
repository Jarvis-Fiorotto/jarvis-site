#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOCUMENT_TABLE = process.env.SUPABASE_DOCUMENTS_TABLE || 'jarvis_site_documents';
const SYNC_TABLE = process.env.SUPABASE_SYNC_RUNS_TABLE || 'jarvis_site_sync_runs';

const documents = [
  ['roster-latest', process.env.ROSTER_JSON || path.join(ROOT, 'app/data/roster-latest.json')],
  ['travel', process.env.TRAVEL_JSON || path.join(ROOT, 'app/data/travel.json')],
  ['flight-status-latest', process.env.FLIGHT_STATUS_JSON || path.join(ROOT, 'app/data/flight-status-latest.json')],
  ['flight-briefing-latest', process.env.FLIGHT_BRIEFING_JSON || path.join(ROOT, 'app/data/flight-briefing-latest.json')]
];

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function endpoint(table) {
  return new URL(`/rest/v1/${table}`, SUPABASE_URL).toString();
}

async function supabaseFetch(table, init = {}) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);
  const response = await fetch(endpoint(table), {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${table} HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function createRun(source) {
  const rows = await supabaseFetch(SYNC_TABLE, {
    method: 'POST',
    body: JSON.stringify([{ source, status: 'running', summary: {} }])
  });
  return rows?.[0]?.id;
}

async function finishRun(id, status, summary, error = null) {
  if (!id) return;
  const url = new URL(endpoint(SYNC_TABLE));
  url.searchParams.set('id', `eq.${id}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status, finished_at: new Date().toISOString(), summary, error })
  });
  if (!response.ok) {
    console.error(`Could not update sync run ${id}: HTTP ${response.status} ${await response.text()}`);
  }
}

async function readDocument(docKey, filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const payload = JSON.parse(raw);
  return {
    doc_key: docKey,
    payload,
    source: 'jarvis-runtime-sync',
    checksum: crypto.createHash('sha256').update(raw).digest('hex')
  };
}

async function upsertDocuments(rows) {
  const url = new URL(endpoint(DOCUMENT_TABLE));
  url.searchParams.set('on_conflict', 'doc_key');
  return supabaseFetch(`${DOCUMENT_TABLE}?${url.searchParams}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows)
  });
}

async function main() {
  const source = process.env.SYNC_SOURCE || 'jarvis-runtime-sync';
  let runId;
  const summary = { documents: [] };
  try {
    runId = await createRun(source);
    const rows = [];
    for (const [docKey, filePath] of documents) {
      try {
        const row = await readDocument(docKey, filePath);
        rows.push(row);
        summary.documents.push({ doc_key: docKey, file: filePath, checksum: row.checksum });
      } catch (error) {
        if (docKey === 'roster-latest' || docKey === 'travel') throw error;
        summary.documents.push({ doc_key: docKey, file: filePath, skipped: true, reason: error.message });
      }
    }
    await upsertDocuments(rows);
    await finishRun(runId, 'ok', summary);
    console.log(JSON.stringify({ status: 'ok', run_id: runId, ...summary }, null, 2));
  } catch (error) {
    await finishRun(runId, 'failed', summary, error instanceof Error ? error.message : String(error));
    console.error(JSON.stringify({ status: 'failed', run_id: runId, error: error instanceof Error ? error.message : String(error), ...summary }, null, 2));
    process.exit(1);
  }
}

main();
