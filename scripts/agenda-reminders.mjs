#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

const DOCUMENT_TABLE = process.env.SUPABASE_DOCUMENTS_TABLE || "jarvis_site_documents";
const AGENDA_DOC_KEY = "agenda-events";
const DELIVERIES_DOC_KEY = "agenda-reminder-deliveries";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("NO_REPLY");
  process.exit(0);
}

async function loadDoc(docKey, fallback) {
  const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
  endpoint.searchParams.set("doc_key", `eq.${docKey}`);
  endpoint.searchParams.set("select", "payload");
  endpoint.searchParams.set("limit", "1");
  const res = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
  if (!res.ok) return fallback;
  const rows = await res.json();
  return rows[0]?.payload || fallback;
}

async function saveDoc(docKey, payload) {
  const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ doc_key: docKey, payload, source: "jarvis-agenda-reminders" })
  });
  if (!res.ok) throw new Error(`save_${docKey}_${res.status}`);
}

function parseRecurrence(rule) {
  if (!rule) return null;
  return Object.fromEntries(rule.split(";").map((part) => part.split("=")));
}

function addStep(date, freq, interval) {
  const next = new Date(date);
  if (freq === "DAILY") next.setDate(next.getDate() + interval);
  if (freq === "WEEKLY") next.setDate(next.getDate() + interval * 7);
  if (freq === "MONTHLY") next.setMonth(next.getMonth() + interval);
  return next;
}

function parseUntil(value) {
  if (!value) return null;
  return new Date(value.replace(/(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z"));
}

function expand(event, windowStart, windowEnd) {
  const recurrence = parseRecurrence(event.recurrenceRule);
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const duration = end.getTime() - start.getTime();
  if (!recurrence) return [{ ...event, occurrenceId: event.id, startsAt: event.startsAt, endsAt: event.endsAt }];
  const freq = recurrence.FREQ;
  const interval = Math.max(1, Number(recurrence.INTERVAL || 1) || 1);
  const until = parseUntil(recurrence.UNTIL) || windowEnd;
  const occurrences = [];
  let cursor = new Date(start);
  let guard = 0;
  while (cursor <= windowEnd && cursor <= until && guard < 730) {
    const occurrenceEnd = new Date(cursor.getTime() + duration);
    if (occurrenceEnd >= windowStart && cursor <= windowEnd) {
      occurrences.push({ ...event, startsAt: cursor.toISOString(), endsAt: occurrenceEnd.toISOString(), occurrenceId: `${event.id}:${cursor.toISOString()}` });
    }
    cursor = addStep(cursor, freq, interval);
    guard += 1;
  }
  return occurrences;
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

const now = new Date();
const lookBack = new Date(now.getTime() - 60 * 1000);
const lookAhead = new Date(now.getTime() + 5 * 60 * 1000);
const agenda = await loadDoc(AGENDA_DOC_KEY, { version: 1, events: [] });
const deliveries = await loadDoc(DELIVERIES_DOC_KEY, { version: 1, delivered: {} });
const delivered = deliveries.delivered || {};
const due = [];

for (const event of agenda.events || []) {
  if (event.status !== "approved") continue;
  const minutesList = Array.isArray(event.reminderMinutesBefore) ? event.reminderMinutesBefore : [];
  if (!minutesList.length) continue;
  for (const occurrence of expand(event, new Date(now.getTime() - 8 * 24 * 3600 * 1000), new Date(now.getTime() + 370 * 24 * 3600 * 1000))) {
    for (const minutes of minutesList) {
      const dueAt = new Date(new Date(occurrence.startsAt).getTime() - minutes * 60000);
      const deliveryKey = `${occurrence.occurrenceId}|${minutes}`;
      if (delivered[deliveryKey]) continue;
      if (dueAt >= lookBack && dueAt <= lookAhead) {
        due.push({ event: occurrence, minutes, deliveryKey });
      }
    }
  }
}

if (!due.length) {
  console.log("NO_REPLY");
  process.exit(0);
}

for (const item of due) delivered[item.deliveryKey] = new Date().toISOString();
await saveDoc(DELIVERIES_DOC_KEY, { version: 1, delivered });

console.log("AGENDA_REMINDERS_DUE");
for (const { event, minutes } of due) {
  const when = minutes >= 1440 ? `${Math.round(minutes / 1440)} dia(s)` : `${minutes} min`;
  console.log(`- Em ${when}: ${event.title} — ${formatDateTime(event.startsAt)} a ${formatDateTime(event.endsAt)}${event.address ? ` — ${event.address}` : ""}`);
}
