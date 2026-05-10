#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROSTER_PATH = path.join(ROOT, 'app/data/roster-latest.json');
const OUT_PATH = path.join(ROOT, 'app/data/flight-briefing-latest.json');
const AVIATION_WEATHER_BASE = 'https://aviationweather.gov/api/data';

const CONFIG = {
  lookaheadMinutes: Number(process.env.FLIGHT_BRIEFING_LOOKAHEAD_MINUTES || 60),
  lookbackMinutes: Number(process.env.FLIGHT_BRIEFING_LOOKBACK_MINUTES || 30),
  maxFlightsPerRun: Number(process.env.FLIGHT_BRIEFING_MAX_FLIGHTS_PER_RUN || 4),
  refreshMinutes: Number(process.env.FLIGHT_BRIEFING_REFRESH_MINUTES || 60),
  requestTimeoutMs: Number(process.env.FLIGHT_BRIEFING_TIMEOUT_MS || 12000)
};

const AIRPORT_IATA_TO_ICAO = {
  AFL: 'SBAT',
  ARU: 'SBAU',
  BEL: 'SBBE',
  BPS: 'SBPS',
  BSB: 'SBBR',
  CAC: 'SBCA',
  CFB: 'SBCB',
  CGH: 'SBSP',
  CGB: 'SBCY',
  CNF: 'SBCF',
  CPV: 'SBKG',
  CWB: 'SBCT',
  FLN: 'SBFL',
  FOR: 'SBFZ',
  GIG: 'SBGL',
  GYN: 'SBGO',
  GRU: 'SBGR',
  IGU: 'SBFI',
  IOS: 'SBIL',
  JPA: 'SBJP',
  JOI: 'SBJV',
  LDB: 'SBLO',
  LIS: 'LPPT',
  MAO: 'SBEG',
  MCZ: 'SBMO',
  MCO: 'KMCO',
  NAT: 'SBSG',
  NVT: 'SBNF',
  POA: 'SBPA',
  PPB: 'SBDN',
  RAO: 'SBRP',
  REC: 'SBRF',
  SDU: 'SBRJ',
  SLZ: 'SBSL',
  SSA: 'SBSV',
  THE: 'SBTE',
  UDI: 'SBUL',
  VCP: 'SBKP',
  VIX: 'SBVT'
};

function now() {
  return process.env.FLIGHT_BRIEFING_NOW ? new Date(process.env.FLIGHT_BRIEFING_NOW) : new Date();
}

function stripDeadhead(label) {
  return String(label || '').replace(/^DHD\s+/i, '').trim();
}

function flightKey(event) {
  if (event.manual) return `manual|${stripDeadhead(event.label)}|${event.from}|${event.to}`;
  return `${event.date}|${stripDeadhead(event.label)}|${event.from}|${event.to}|${event.start_time}`;
}

function airportIcao(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(normalized)) return normalized;
  return AIRPORT_IATA_TO_ICAO[normalized] || null;
}

function eventStart(event) {
  if (event.start_local) return new Date(event.start_local);
  return new Date(`${event.date}T${event.start_time || '00:00'}:00-03:00`);
}

function manualEvent(at = now()) {
  const flight = process.env.FLIGHT_BRIEFING_MANUAL_FLIGHT;
  const from = process.env.FLIGHT_BRIEFING_MANUAL_FROM;
  const to = process.env.FLIGHT_BRIEFING_MANUAL_TO;
  if (!flight || !from || !to) return null;
  const date = process.env.FLIGHT_BRIEFING_MANUAL_DATE || at.toISOString().slice(0, 10);
  const time = process.env.FLIGHT_BRIEFING_MANUAL_TIME || new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(at).replace('h', ':');
  const cleanFlight = String(flight).replace(/\s+/g, '').toUpperCase();
  return {
    id: `manual-${cleanFlight}-${from}-${to}`,
    date,
    start_local: `${date}T${time}:00-03:00`,
    end_local: `${date}T${time}:00-03:00`,
    start_time: time,
    end_time: time,
    type: 'FLY',
    label: cleanFlight,
    flight_number: cleanFlight,
    from: String(from).toUpperCase(),
    to: String(to).toUpperCase(),
    position: 'TEST',
    details: 'Manual test briefing',
    canceled: false,
    manual: true
  };
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'jarvis-site-flight-briefing/1.0' }
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAviationWeather(product, icao) {
  if (!icao) return { status: 'unavailable', reason: 'missing_icao', raw: null };
  const url = new URL(`${AVIATION_WEATHER_BASE}/${product}`);
  url.searchParams.set('ids', icao);
  url.searchParams.set('format', 'json');
  try {
    const data = await fetchJson(url);
    const report = Array.isArray(data) ? data[0] || null : null;
    return report ? { status: 'ok', raw: report.rawOb || report.rawTAF || null, decoded: report } : { status: 'not_found', raw: null };
  } catch (error) {
    return { status: 'error', reason: error.message, raw: null };
  }
}

function flightRulesFromMetar(metar) {
  const rules = String(metar?.decoded?.fltCat || metar?.decoded?.flightCategory || '').toUpperCase();
  if (rules) return rules;
  const vis = Number.parseFloat(String(metar?.decoded?.visib || '').replace('+', ''));
  const clouds = metar?.decoded?.clouds || [];
  const ceiling = Array.isArray(clouds)
    ? clouds.filter((cloud) => ['BKN', 'OVC', 'VV'].includes(cloud.cover || cloud.coverage)).map((cloud) => Number(cloud.base)).filter(Number.isFinite).sort((a, b) => a - b)[0]
    : null;
  if (Number.isFinite(vis) && vis < 1 || Number.isFinite(ceiling) && ceiling < 500) return 'LIFR';
  if (Number.isFinite(vis) && vis < 3 || Number.isFinite(ceiling) && ceiling < 1000) return 'IFR';
  if (Number.isFinite(vis) && vis <= 5 || Number.isFinite(ceiling) && ceiling <= 3000) return 'MVFR';
  return 'VFR/unknown';
}

function hazardHints(station) {
  const text = [station.metar?.raw, station.taf?.raw].filter(Boolean).join(' ').toUpperCase();
  const hints = [];
  if (/TS|CB|TCU|VCTS|TEMPO[^\n]*(TS|CB)/.test(text)) hints.push('atividade convectiva/CB/TS');
  if (/\+RA|SHRA|RA|DZ/.test(text)) hints.push('precipitação');
  if (/FG|BR|HZ|FU|DU|SA/.test(text)) hints.push('restrição de visibilidade');
  if (/BKN00|OVC00|VV00|BKN0[0-2]|OVC0[0-2]/.test(text)) hints.push('teto baixo');
  if (/WS|WIND SHEAR/.test(text)) hints.push('windshear');
  if (/G\d{2}KT/.test(text)) hints.push('rajadas');
  return [...new Set(hints)];
}

function stationSummary(label, station) {
  if (!station?.icao) return `${label}: ICAO não mapeado; sem consulta automática.`;
  const parts = [];
  const rules = flightRulesFromMetar(station.metar);
  if (station.metar?.raw) parts.push(`METAR ${rules}`);
  if (station.taf?.raw) parts.push('TAF disponível');
  const hazards = hazardHints(station);
  if (hazards.length) parts.push(`atenção para ${hazards.join(', ')}`);
  return `${label} ${station.iata}/${station.icao}: ${parts.length ? parts.join('; ') : 'sem METAR/TAF retornado'}.`;
}

function buildAnalysis(briefing) {
  const originHazards = hazardHints(briefing.airports.origin);
  const destinationHazards = hazardHints(briefing.airports.destination);
  const alternateHazards = briefing.airports.alternates.flatMap(hazardHints);
  const allHazards = [...new Set([...originHazards, ...destinationHazards, ...alternateHazards])];
  const risk = allHazards.some((h) => /convectiva|windshear|teto baixo|visibilidade/.test(h)) ? 'atenção' : 'normal';
  const lines = [
    stationSummary('Origem', briefing.airports.origin),
    stationSummary('Destino', briefing.airports.destination)
  ];
  if (briefing.airports.alternates.length) {
    lines.push(...briefing.airports.alternates.map((station, index) => stationSummary(`Alternado ${index + 1}`, station)));
  } else {
    lines.push('Alternados: aguardando extração do Lido para incluir aeroportos planejados no despacho.');
  }
  lines.push(risk === 'atenção'
    ? `Análise JARVIS: há sinais que merecem briefing mais cuidadoso (${allHazards.join(', ')}). Conferir Lido/OFP, NOTAMs oficiais, mínimos, combustível e tendência antes da apresentação.`
    : 'Análise JARVIS: sem gatilhos meteorológicos fortes detectados automaticamente em METAR/TAF. Ainda assim, confirmar Lido/OFP e NOTAMs oficiais antes do voo.');
  return { risk, summary: lines.join(' ') };
}

async function buildStation(iata) {
  const icao = airportIcao(iata);
  const [metar, taf] = await Promise.all([
    fetchAviationWeather('metar', icao),
    fetchAviationWeather('taf', icao)
  ]);
  return { iata, icao, metar, taf, notams: { status: 'pending_lido', items: [] } };
}

function shouldRefresh(cached, event, at) {
  if (!cached?.updated_at) return true;
  const ageMinutes = (at.getTime() - new Date(cached.updated_at).getTime()) / 60000;
  const minutesToDeparture = (eventStart(event).getTime() - at.getTime()) / 60000;
  if (minutesToDeparture <= CONFIG.lookaheadMinutes && minutesToDeparture >= -CONFIG.lookbackMinutes) {
    return ageMinutes >= CONFIG.refreshMinutes;
  }
  return false;
}

async function buildBriefing(event, at) {
  const origin = await buildStation(event.from);
  const destination = await buildStation(event.to);
  const alternates = [];
  const briefing = {
    key: flightKey(event),
    updated_at: at.toISOString(),
    source: 'aviationweather.gov + roster; lido_pending',
    status: 'partial_without_lido',
    flight: {
      date: event.date,
      label: event.label,
      flight_number: stripDeadhead(event.flight_number || event.label),
      from: event.from,
      to: event.to,
      departure_local: event.start_local,
      arrival_local: event.end_local,
      start_time: event.start_time,
      end_time: event.end_time,
      aircraft: event.aircraft || null,
      equipment: event.equipment || null,
      position: event.position || null
    },
    airports: { origin, destination, alternates },
    lido: {
      status: 'pending_login_automation',
      url: 'https://azu.lido.aero',
      notes: 'Alternados, NOTAMs oficiais e briefing package serão preenchidos após automação segura do Lido.'
    }
  };
  briefing.analysis = buildAnalysis(briefing);
  return briefing;
}

async function main() {
  const at = now();
  const roster = await readJson(ROSTER_PATH, null);
  if (!roster) throw new Error(`Cannot read ${ROSTER_PATH}`);
  const previous = await readJson(OUT_PATH, { briefings: {} });
  const briefings = { ...(previous.briefings || {}) };

  const windowStart = new Date(at.getTime() - CONFIG.lookbackMinutes * 60000);
  const windowEnd = new Date(at.getTime() + CONFIG.lookaheadMinutes * 60000);
  const manual = manualEvent(at);
  const candidates = (manual ? [manual] : (roster.events || [])
    .filter((event) => event.type === 'FLY' && !event.canceled)
    .filter((event) => {
      const start = eventStart(event);
      return start >= windowStart && start <= windowEnd;
    })
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())
    .slice(0, CONFIG.maxFlightsPerRun));

  let queries = 0;
  const logs = [];
  for (const event of candidates) {
    const key = flightKey(event);
    if (!shouldRefresh(briefings[key], event, at)) {
      logs.push(`cache ${key}`);
      continue;
    }
    briefings[key] = await buildBriefing(event, at);
    queries += 4; // METAR+TAF origem/destino. Alternados entram quando Lido estiver ativo.
    logs.push(`updated ${key}`);
  }

  const output = {
    updated_at: at.toISOString(),
    provider: 'aviationweather.gov',
    status: 'partial_until_lido_enabled',
    limits: CONFIG,
    last_run: { queries, candidates: candidates.length, logs },
    briefings
  };
  await writeFile(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ updated_at: output.updated_at, last_run: output.last_run }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
