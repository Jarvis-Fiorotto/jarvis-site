#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROSTER_PATH = path.join(ROOT, 'app/data/roster-latest.json');
const OUT_PATH = path.join(ROOT, 'app/data/flight-status-latest.json');
const API_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const API_KEY = process.env.FLIGHTAWARE_API_KEY;

const CONFIG = {
  monthlyQueryCap: Number(process.env.FLIGHTAWARE_MONTHLY_QUERY_CAP || 300),
  maxQueriesPerRun: Number(process.env.FLIGHTAWARE_MAX_QUERIES_PER_RUN || 6),
  minSecondsBetweenQueries: Number(process.env.FLIGHTAWARE_MIN_SECONDS_BETWEEN_QUERIES || 7),
  activeRefreshMinutes: Number(process.env.FLIGHTAWARE_ACTIVE_REFRESH_MINUTES || 15),
  scheduledRefreshMinutes: Number(process.env.FLIGHTAWARE_SCHEDULED_REFRESH_MINUTES || 180),
  completedRefreshMinutes: Number(process.env.FLIGHTAWARE_COMPLETED_REFRESH_MINUTES || 1440),
  lookbackHours: Number(process.env.FLIGHTAWARE_LOOKBACK_HOURS || 8),
  lookaheadHours: Number(process.env.FLIGHTAWARE_LOOKAHEAD_HOURS || 36)
};

function now() {
  return process.env.FLIGHTAWARE_NOW ? new Date(process.env.FLIGHTAWARE_NOW) : new Date();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoLocal(date, time) {
  return new Date(`${date}T${time || '00:00'}:00-03:00`).toISOString();
}

function stripDeadhead(label) {
  return String(label || '').replace(/^DHD\s+/i, '').trim();
}

function toIcaoIdent(label) {
  const flight = stripDeadhead(label).replace(/\s+/g, '').toUpperCase();
  return flight.replace(/^AD/, 'AZU');
}

function flightKey(event) {
  return `${event.date}|${stripDeadhead(event.label)}|${event.from}|${event.to}|${event.start_time}`;
}

function monthKey(date = now()) {
  return date.toISOString().slice(0, 7);
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function classifyStatus(flight) {
  if (!flight) return 'unknown';
  const raw = String(flight.status || '').toLowerCase();
  if (raw.includes('cancel')) return 'cancelled';
  if (flight.actual_on || flight.actual_in) return 'landed';
  if (flight.actual_off || flight.actual_out) return 'airborne';
  if (raw.includes('delayed')) return 'delayed';
  if (raw.includes('scheduled')) return 'scheduled';
  return raw || 'unknown';
}

function minutesSince(iso, at = now()) {
  if (!iso) return Infinity;
  return (at.getTime() - new Date(iso).getTime()) / 60000;
}

function shouldRefresh(cached, event, at = now()) {
  if (!cached) return true;
  if (cached.error && minutesSince(cached.updated_at, at) < 60) return false;

  const status = cached.normalized_status;
  const age = minutesSince(cached.updated_at, at);
  if (['landed', 'cancelled'].includes(status)) return age >= CONFIG.completedRefreshMinutes;

  const start = new Date(toIsoLocal(event.date, event.start_time));
  const end = new Date(toIsoLocal(event.date, event.end_time));
  const activeWindowStart = new Date(start.getTime() - 2 * 60 * 60 * 1000);
  const activeWindowEnd = new Date(end.getTime() + 2 * 60 * 60 * 1000);
  const isActiveWindow = at >= activeWindowStart && at <= activeWindowEnd;
  return age >= (isActiveWindow ? CONFIG.activeRefreshMinutes : CONFIG.scheduledRefreshMinutes);
}

function pickMatchingFlight(flights, event) {
  const targetDate = event.date;
  const from = event.from;
  const to = event.to;
  const sameRoute = flights.filter((flight) => {
    const origin = flight.origin?.code_iata || flight.origin?.code || flight.origin?.code_icao;
    const destination = flight.destination?.code_iata || flight.destination?.code || flight.destination?.code_icao;
    return origin === from && destination === to;
  });
  const pool = sameRoute.length ? sameRoute : flights;
  return pool.find((flight) => String(flight.scheduled_out || flight.scheduled_off || '').slice(0, 10) === targetDate) || pool[0] || null;
}

function simplifyFlight(flight) {
  if (!flight) return null;
  return {
    ident: flight.ident,
    ident_icao: flight.ident_icao,
    ident_iata: flight.ident_iata,
    fa_flight_id: flight.fa_flight_id,
    status: flight.status,
    normalized_status: classifyStatus(flight),
    origin: flight.origin?.code_iata || flight.origin?.code || null,
    destination: flight.destination?.code_iata || flight.destination?.code || null,
    scheduled_out: flight.scheduled_out || null,
    estimated_out: flight.estimated_out || null,
    actual_out: flight.actual_out || null,
    scheduled_off: flight.scheduled_off || null,
    estimated_off: flight.estimated_off || null,
    actual_off: flight.actual_off || null,
    scheduled_on: flight.scheduled_on || null,
    estimated_on: flight.estimated_on || null,
    actual_on: flight.actual_on || null,
    scheduled_in: flight.scheduled_in || null,
    estimated_in: flight.estimated_in || null,
    actual_in: flight.actual_in || null,
    terminal_origin: flight.terminal_origin || null,
    terminal_destination: flight.terminal_destination || null,
    gate_origin: flight.gate_origin || null,
    gate_destination: flight.gate_destination || null
  };
}

async function fetchFlight(event) {
  const ident = toIcaoIdent(event.label);
  const start = new Date(new Date(toIsoLocal(event.date, event.start_time)).getTime() - 6 * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(toIsoLocal(event.date, event.start_time)).getTime() + 18 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${API_BASE}/flights/${ident}`);
  url.searchParams.set('ident_type', 'designator');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('max_pages', '1');

  const response = await fetch(url, { headers: { 'x-apikey': API_KEY } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const err = new Error(`FlightAware HTTP ${response.status}`);
    err.status = response.status;
    err.retryAfter = retryAfter;
    err.body = body;
    throw err;
  }
  return pickMatchingFlight(body.flights || [], event);
}

async function main() {
  if (!API_KEY) throw new Error('Missing FLIGHTAWARE_API_KEY');

  const at = now();
  const roster = await readJson(ROSTER_PATH, null);
  if (!roster) throw new Error(`Cannot read ${ROSTER_PATH}`);

  const previous = await readJson(OUT_PATH, { flights: {}, usage: {} });
  const usageMonth = previous.usage?.month === monthKey(at) ? previous.usage : { month: monthKey(at), queries: 0 };
  const flights = { ...(previous.flights || {}) };

  const windowStart = new Date(at.getTime() - CONFIG.lookbackHours * 60 * 60 * 1000);
  const windowEnd = new Date(at.getTime() + CONFIG.lookaheadHours * 60 * 60 * 1000);
  const candidates = roster.events
    .filter((event) => event.type === 'FLY')
    .filter((event) => {
      const eventStart = new Date(toIsoLocal(event.date, event.start_time));
      return eventStart >= windowStart && eventStart <= windowEnd;
    })
    .sort((a, b) => toIsoLocal(a.date, a.start_time).localeCompare(toIsoLocal(b.date, b.start_time)));

  let queries = 0;
  const logs = [];
  for (const event of candidates) {
    if (queries >= CONFIG.maxQueriesPerRun) break;
    if (usageMonth.queries >= CONFIG.monthlyQueryCap) {
      logs.push(`budget-stop monthly cap ${CONFIG.monthlyQueryCap}`);
      break;
    }
    const key = flightKey(event);
    if (!shouldRefresh(flights[key], event, at)) {
      logs.push(`cache ${key}`);
      continue;
    }
    if (queries > 0) await sleep(CONFIG.minSecondsBetweenQueries * 1000);
    try {
      const flight = await fetchFlight(event);
      queries += 1;
      usageMonth.queries += 1;
      flights[key] = {
        key,
        roster: {
          date: event.date,
          label: event.label,
          flight: stripDeadhead(event.label),
          ident_icao: toIcaoIdent(event.label),
          from: event.from,
          to: event.to,
          start_time: event.start_time,
          end_time: event.end_time
        },
        updated_at: at.toISOString(),
        source: 'flightaware_aeroapi',
        ...simplifyFlight(flight)
      };
      logs.push(`updated ${key}`);
    } catch (error) {
      queries += 1;
      usageMonth.queries += 1;
      flights[key] = {
        key,
        roster: {
          date: event.date,
          label: event.label,
          flight: stripDeadhead(event.label),
          ident_icao: toIcaoIdent(event.label),
          from: event.from,
          to: event.to,
          start_time: event.start_time,
          end_time: event.end_time
        },
        updated_at: at.toISOString(),
        source: 'flightaware_aeroapi',
        normalized_status: 'unavailable',
        error: { message: error.message, status: error.status || null, retry_after: error.retryAfter || null }
      };
      logs.push(`error ${key}: ${error.message}`);
      if (error.status === 429 && error.retryAfter) break;
    }
  }

  const output = {
    updated_at: at.toISOString(),
    provider: 'FlightAware AeroAPI',
    limits: CONFIG,
    usage: usageMonth,
    last_run: { queries, candidates: candidates.length, logs },
    flights
  };
  await writeFile(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ updated_at: output.updated_at, usage: output.usage, last_run: output.last_run }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
