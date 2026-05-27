#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const ROSTER_PATH = path.join(ROOT, 'app/data/roster-latest.json');
const OUT_PATH = path.join(ROOT, 'app/data/flight-briefing-latest.json');
const AVIATION_WEATHER_BASE = 'https://aviationweather.gov/api/data';

const CONFIG = {
  lookaheadMinutes: Number(process.env.FLIGHT_BRIEFING_LOOKAHEAD_MINUTES || 60),
  lookbackMinutes: Number(process.env.FLIGHT_BRIEFING_LOOKBACK_MINUTES || 30),
  maxFlightsPerRun: Number(process.env.FLIGHT_BRIEFING_MAX_FLIGHTS_PER_RUN || 4),
  refreshMinutes: Number(process.env.FLIGHT_BRIEFING_REFRESH_MINUTES || 60),
  requestTimeoutMs: Number(process.env.FLIGHT_BRIEFING_TIMEOUT_MS || 12000),
  liveWeatherMaxAgeMinutes: Number(process.env.FLIGHT_BRIEFING_LIVE_WEATHER_MAX_AGE_MINUTES || 90)
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

function reportIssuedAt(product, report) {
  const candidates = product === 'metar'
    ? [report?.obsTime, report?.reportTime, report?.receiptTime]
    : [report?.issueTime, report?.validTimeFrom, report?.reportTime, report?.receiptTime];
  const value = candidates.find(Boolean);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function reportAgeMinutes(issuedAt, reference = now()) {
  if (!issuedAt) return null;
  const age = Math.round((reference.getTime() - new Date(issuedAt).getTime()) / 60000);
  return Number.isFinite(age) ? age : null;
}

function freshnessStatus(ageMinutes) {
  if (!Number.isFinite(ageMinutes)) return 'unknown';
  if (ageMinutes < -60) return 'clock_mismatch';
  if (ageMinutes > 1440) return 'stale_or_clock_mismatch';
  if (ageMinutes > CONFIG.liveWeatherMaxAgeMinutes) return 'older_than_policy';
  return 'fresh';
}

async function fetchAviationWeather(product, icao) {
  if (!icao) return { status: 'unavailable', reason: 'missing_icao', raw: null, source: 'aviationweather.gov' };
  const url = new URL(`${AVIATION_WEATHER_BASE}/${product}`);
  url.searchParams.set('ids', icao);
  url.searchParams.set('format', 'json');
  try {
    const data = await fetchJson(url);
    const report = Array.isArray(data) ? data[0] || null : null;
    if (!report) return { status: 'not_found', raw: null, source: 'aviationweather.gov' };
    const issuedAt = reportIssuedAt(product, report);
    const ageMinutes = reportAgeMinutes(issuedAt);
    return {
      status: 'ok',
      source: 'aviationweather.gov',
      fetched_at: now().toISOString(),
      issued_at: issuedAt,
      age_minutes: ageMinutes,
      freshness_status: freshnessStatus(ageMinutes),
      raw: report.rawOb || report.rawTAF || null,
      decoded: report
    };
  } catch (error) {
    return { status: 'error', reason: error.message, raw: null, source: 'aviationweather.gov' };
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

function freshnessLabel(report) {
  if (!report?.raw) return null;
  if (report.freshness_status === 'stale_or_clock_mismatch') return 'idade incompatível/possivelmente defasado';
  if (report.freshness_status === 'older_than_policy') return `idade ${report.age_minutes} min, acima da política`;
  if (Number.isFinite(report.age_minutes)) return `idade ${report.age_minutes} min`;
  return 'idade n/d';
}

function stationSummary(label, station) {
  if (!station?.icao) return `${label}: ICAO não mapeado; sem consulta automática.`;
  const parts = [];
  const rules = flightRulesFromMetar(station.metar);
  if (station.metar?.raw) parts.push(`METAR ${rules}${freshnessLabel(station.metar) ? ` (${freshnessLabel(station.metar)})` : ''}`);
  if (station.taf?.raw) parts.push(`TAF disponível${freshnessLabel(station.taf) ? ` (${freshnessLabel(station.taf)})` : ''}`);
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
    ? `Análise JARVIS: há sinais que merecem briefing mais cuidadoso (${allHazards.join(', ')}). METAR/TAF vêm do fallback vivo mais recente disponível; conferir Lido/OFP, NOTAMs oficiais, mínimos, combustível e tendência antes da apresentação.`
    : 'Análise JARVIS: sem gatilhos meteorológicos fortes detectados automaticamente em METAR/TAF do fallback vivo. Ainda assim, confirmar Lido/OFP, NOTAMs oficiais e cartas antes do voo.');
  return { risk, summary: lines.join(' ') };
}

async function buildStation(iata, lidoNotams = null) {
  const icao = airportIcao(iata);
  const [metar, taf] = await Promise.all([
    fetchAviationWeather('metar', icao),
    fetchAviationWeather('taf', icao)
  ]);
  return { iata, icao, metar, taf, notams: lidoNotams || { status: 'pending_lido', items: [] } };
}

function lidoEnabled() {
  return process.env.LIDO_BRIEFING_ENABLED === '1';
}

function runLidoFetch(event) {
  const scriptPath = path.join(ROOT, '..', 'scripts', 'lido-fetch-briefing.mjs');
  const flightNumber = stripDeadhead(event.flight_number || event.label).replace(/^[A-Z]{2,3}/i, '').replace(/\D/g, '');
  const result = spawnSync('node', [scriptPath], {
    cwd: path.join(ROOT, '..'),
    encoding: 'utf8',
    timeout: Number(process.env.LIDO_BRIEFING_TIMEOUT_MS || 180000),
    env: {
      ...process.env,
      FLIGHT_NO: flightNumber,
      FLIGHT_DATE: event.date,
      FLIGHT_FROM: event.from || '',
      FLIGHT_TO: event.to || '',
      LIDO_INCLUDE_RAW: '0'
    }
  });
  const text = result.stdout?.trim() || '';
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { result, text, parsed };
}

function runLidoReauth() {
  if (process.env.LIDO_AUTO_REAUTH === '0') return { skipped: true };
  const scriptPath = path.join(ROOT, '..', 'scripts', 'lido-reauth.mjs');
  const result = spawnSync('node', [scriptPath], {
    cwd: path.join(ROOT, '..'),
    encoding: 'utf8',
    timeout: Number(process.env.LIDO_REAUTH_TIMEOUT_MS || 90000),
    env: process.env
  });
  const text = result.stdout?.trim() || '';
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { result, text, parsed };
}

function formatLidoFailure(attempt, reauth = null) {
  const { result, text, parsed } = attempt;
  return {
    source: 'lido',
    status: parsed?.status || 'error',
    reason: parsed?.detail || result.error?.message || result.stderr?.slice(0, 500) || text.slice(0, 500) || `exit_${result.status}`,
    reauth: reauth?.parsed ? { status: reauth.parsed.status, reason: reauth.parsed.reason, cdpPort: reauth.parsed.cdpPort } : undefined,
    url: 'https://azu.lido.aero'
  };
}

function fetchLidoBriefing(event) {
  if (!lidoEnabled()) {
    return {
      status: 'disabled',
      url: 'https://azu.lido.aero',
      notes: 'Lido desativado neste ambiente; habilitar com LIDO_BRIEFING_ENABLED=1 em execução local segura.'
    };
  }
  const first = runLidoFetch(event);
  if (first.result.status === 0 && first.parsed) return first.parsed;

  const canBenefitFromReauth = new Set([
    'auth_required',
    'auth_cookie_missing',
    'lido_tab_not_found',
    'cdp_unavailable'
  ]);

  if (canBenefitFromReauth.has(first.parsed?.status)) {
    const reauth = runLidoReauth();
    if (reauth.parsed?.status === 'ok') {
      const retry = runLidoFetch(event);
      if (retry.result.status === 0 && retry.parsed) return { ...retry.parsed, reauth: { status: 'ok', reason: reauth.parsed.reason, cdpPort: reauth.parsed.cdpPort } };
      return formatLidoFailure(retry, reauth);
    }
    return formatLidoFailure(first, reauth);
  }

  return formatLidoFailure(first);
}

function shouldRefresh(cached, event, at) {
  if (process.env.FLIGHT_BRIEFING_FORCE_REFRESH === '1') return true;
  if (!cached?.updated_at) return true;
  const ageMinutes = (at.getTime() - new Date(cached.updated_at).getTime()) / 60000;
  const minutesToDeparture = (eventStart(event).getTime() - at.getTime()) / 60000;
  if (minutesToDeparture <= CONFIG.lookaheadMinutes && minutesToDeparture >= -CONFIG.lookbackMinutes) {
    return ageMinutes >= CONFIG.refreshMinutes;
  }
  return false;
}

async function buildBriefing(event, at) {
  const lido = fetchLidoBriefing(event);
  const lidoAlternates = lido.status === 'ok' ? (lido.ofp?.alternates || []) : [];
  const originCode = lido.ofp?.airports?.origin?.iata || event.from;
  const destinationCode = lido.ofp?.airports?.destination?.iata || event.to;
  const [origin, destination, ...alternates] = await Promise.all([
    buildStation(originCode, lido.status === 'ok' ? { status: 'available_in_lido_package', highlights: lido.notams?.highlights || [], counts: lido.notams?.counts || {} } : null),
    buildStation(destinationCode, lido.status === 'ok' ? { status: 'available_in_lido_package', highlights: lido.notams?.highlights || [], counts: lido.notams?.counts || {} } : null),
    ...lidoAlternates.map((alternate) => buildStation(alternate.iata || alternate.icao, { status: 'available_in_lido_package', highlights: lido.notams?.highlights || [], counts: lido.notams?.counts || {} }))
  ]);
  const briefing = {
    key: flightKey(event),
    updated_at: at.toISOString(),
    source: lido.status === 'ok' ? 'live_fallback + lido' : 'live_fallback + roster; lido_pending',
    status: lido.status === 'ok' ? 'ok_with_lido_and_live_fallback' : 'partial_with_live_fallback_without_lido',
    freshness_policy: {
      rule: 'Lido é fonte oficial para OFP/alternados/pacote corporativo, mas pode ter sido emitido horas antes. METAR/TAF são sempre reconsultados no fallback vivo na execução; cartas/NOTAM devem usar fallback vivo quando provider estiver disponível.',
      metar_taf_primary: 'aviationweather.gov live fetch',
      lido_weather_role: 'supplemental_official_package_not_freshness_authority',
      notam_charts_live_provider: process.env.AISWEB_API_KEY || process.env.DECEA_API_KEY ? 'decea/aisweb_configured' : 'pending_decea_aisweb_access',
      max_live_weather_age_minutes: CONFIG.liveWeatherMaxAgeMinutes
    },
    data_currency: {
      metar_taf: 'live_fallback_checked_each_run',
      ofp_alternates: lido.status === 'ok' ? 'lido_official_package' : 'lido_unavailable',
      notam: lido.status === 'ok' ? 'lido_official_package_live_fallback_pending' : 'lido_unavailable_live_fallback_pending',
      charts: 'live_fallback_pending_decea_aisweb'
    },
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
    lido
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
