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
    if (!process.env[key]) process.env[key] = rawValue.replace(/^[\'"]|[\'"]$/g, "");
  }
}

const DOCUMENT_TABLE = process.env.SUPABASE_DOCUMENTS_TABLE || "jarvis_site_documents";
const ROSTER_DOC_KEY = "roster-latest";
const DELIVERIES_DOC_KEY = "commute-alert-deliveries";
const SAO_PAULO_TZ = "America/Sao_Paulo";
const DEFAULT_VCP_LAT = -23.0074;
const DEFAULT_VCP_LON = -47.1345;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function numberEnv(name, fallback = null) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  originLabel: process.env.COMMUTE_ORIGIN_LABEL || "casa",
  destinationLabel: process.env.COMMUTE_VCP_DESTINATION_LABEL || "Aeroporto de Viracopos",
  originLat: numberEnv("COMMUTE_ORIGIN_LAT"),
  originLon: numberEnv("COMMUTE_ORIGIN_LON"),
  vcpLat: numberEnv("COMMUTE_VCP_LAT", DEFAULT_VCP_LAT),
  vcpLon: numberEnv("COMMUTE_VCP_LON", DEFAULT_VCP_LON),
  airportWalkBufferMinutes: numberEnv("COMMUTE_AIRPORT_WALK_BUFFER_MINUTES", 20),
  trafficSafetyBufferMinutes: numberEnv("COMMUTE_FREE_API_TRAFFIC_BUFFER_MINUTES", 15),
  lookAheadHours: numberEnv("COMMUTE_LOOKAHEAD_HOURS", 48),
  remindHoursBefore: (process.env.COMMUTE_REMIND_HOURS_BEFORE || "24,4,2")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
};

if (!url || !key) {
  console.log("NO_REPLY");
  process.exit(0);
}

if (!Number.isFinite(config.originLat) || !Number.isFinite(config.originLon)) {
  console.log("COMMUTE_CONFIG_MISSING origin_coordinates");
  console.log("Configure COMMUTE_ORIGIN_LAT and COMMUTE_ORIGIN_LON in .env.local/Vercel before enabling commute alerts.");
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
  if (!serviceKey) return;
  const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ doc_key: docKey, payload, source: "jarvis-commute-alerts" })
  });
  if (!res.ok) throw new Error(`save_${docKey}_${res.status}`);
}

function localFormat(iso, options = {}) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options
  }).format(new Date(iso));
}

function minutesLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  if (!m) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function isVcp(value) {
  return String(value || "").toUpperCase() === "VCP";
}

function isVcpCommitment(event) {
  if (event.canceled) return false;
  const code = String(event.code || event.label || "").toUpperCase();
  if (event.type === "CHECK" && event.subtype === "IN" && (isVcp(event.from) || isVcp(event.to))) return true;
  if (event.type === "NON_OP" && isVcp(event.from) && /^(SB|RHC|REA|QRH|AVT)/.test(code)) return true;
  return false;
}

function commitmentTitle(event) {
  const code = event.code || event.label;
  if (event.type === "CHECK") return "Apresentação em VCP";
  if (String(code || "").startsWith("SB")) return `Sobreaviso ${code}`;
  if (String(code || "").startsWith("RHC")) return `Reserva Hotcrew ${code}`;
  if (String(code || "").startsWith("REA")) return `Reserva acionada ${code}`;
  if (String(code || "").startsWith("QRH")) return "Treinamento QRH em VCP";
  if (String(code || "").startsWith("AVT")) return "Avaliação técnica em VCP";
  return `${event.label || event.type} em VCP`;
}

async function osrmDurationMinutes() {
  const endpoint = new URL(`https://router.project-osrm.org/route/v1/driving/${config.originLon},${config.originLat};${config.vcpLon},${config.vcpLat}`);
  endpoint.searchParams.set("overview", "false");
  endpoint.searchParams.set("alternatives", "false");
  endpoint.searchParams.set("steps", "false");
  const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`osrm_${res.status}`);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration;
  if (!Number.isFinite(seconds)) throw new Error("osrm_duration_missing");
  return Math.ceil(seconds / 60);
}

const now = new Date();
const lookAheadEnd = new Date(now.getTime() + config.lookAheadHours * 3600 * 1000);
const roster = await loadDoc(ROSTER_DOC_KEY, { events: [] });
const deliveries = await loadDoc(DELIVERIES_DOC_KEY, { version: 1, delivered: {} });
const delivered = deliveries.delivered || {};
const candidates = (roster.events || [])
  .filter(isVcpCommitment)
  .filter((event) => {
    const start = new Date(event.start_local || event.start_utc);
    return start >= now && start <= lookAheadEnd;
  })
  .sort((a, b) => new Date(a.start_local || a.start_utc) - new Date(b.start_local || b.start_utc));

if (!candidates.length) {
  console.log("NO_REPLY");
  process.exit(0);
}

let routeMinutes;
try {
  routeMinutes = await osrmDurationMinutes();
} catch (error) {
  console.log(`COMMUTE_ALERTS_BLOCKED route_api_failed ${error.message}`);
  process.exit(0);
}

const due = [];
for (const event of candidates) {
  const start = new Date(event.start_local || event.start_utc);
  const minutesUntilStart = (start.getTime() - now.getTime()) / 60000;
  for (const hoursBefore of config.remindHoursBefore) {
    const targetMinutes = hoursBefore * 60;
    const deliveryKey = `${event.id}|${start.toISOString()}|${hoursBefore}h`;
    if (delivered[deliveryKey]) continue;
    if (minutesUntilStart <= targetMinutes && minutesUntilStart >= targetMinutes - 65) {
      due.push({ event, start, hoursBefore, deliveryKey });
    }
  }
}

if (!due.length) {
  console.log("NO_REPLY");
  process.exit(0);
}

for (const item of due) delivered[item.deliveryKey] = new Date().toISOString();
await saveDoc(DELIVERIES_DOC_KEY, { version: 1, delivered });

console.log("COMMUTE_ALERTS_DUE");
console.log(`Origem: ${config.originLabel}`);
console.log(`Destino: ${config.destinationLabel}`);
console.log(`Rota free OSRM: ${minutesLabel(routeMinutes)} sem trânsito em tempo real.`);
console.log(`Buffer aeroporto: ${config.airportWalkBufferMinutes} min.`);
console.log(`Buffer conservador por não haver trânsito realtime grátis: ${config.trafficSafetyBufferMinutes} min.`);
for (const { event, start, hoursBefore } of due) {
  const totalMinutes = routeMinutes + config.airportWalkBufferMinutes + config.trafficSafetyBufferMinutes;
  const leaveAt = new Date(start.getTime() - totalMinutes * 60000);
  const airportTarget = new Date(start.getTime() - config.airportWalkBufferMinutes * 60000);
  console.log(`- ${commitmentTitle(event)} — ${localFormat(start.toISOString())}`);
  console.log(`  Aviso: ${hoursBefore}h antes | alvo aeroporto: ${localFormat(airportTarget.toISOString(), { weekday: undefined })} | saída recomendada: ${localFormat(leaveAt.toISOString(), { weekday: undefined })}`);
}
