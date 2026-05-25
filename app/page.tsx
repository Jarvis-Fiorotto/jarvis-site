import rosterFallback from "./data/roster-latest.json";
import hotelsFallback from "./data/hotels-latest.json";
import flightStatusFallback from "./data/flight-status-latest.json";
import flightBriefingFallback from "./data/flight-briefing-latest.json";
import { currentUser, hasModule, isAdmin } from "../lib/auth";
import { redirect } from "next/navigation";
import { loadRuntimeDocument } from "../lib/runtime-data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type RosterEvent = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  start_local: string;
  end_local: string;
  type: string;
  subtype?: string;
  label: string;
  from?: string | null;
  to?: string | null;
  flight_number?: string | null;
  aircraft?: string | null;
  equipment?: string | null;
  position?: string | null;
  pairing_label?: string | null;
  details?: string | null;
  canceled?: boolean;
};

type RosterPendingChange = {
  type: "added" | "removed" | "modified";
  date?: string | null;
  id: string;
  fields?: string[];
  current?: RosterEvent | null;
  proposed?: RosterEvent | null;
  summary?: string | null;
};

type RosterPendingChanges = {
  status: "pending" | "none";
  count: number;
  generated_at?: string | null;
  source?: string | null;
  safety?: string | null;
  changes: RosterPendingChange[];
  by_date?: Record<string, RosterPendingChange[]>;
};

type RosterData = {
  source: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  counts: { events: number; duties: number; pairings: number; activities: number };
  events: RosterEvent[];
  pending_changes?: RosterPendingChanges | null;
};
type HotelTransport = {
  company: string;
  phone: string;
  direction: string;
  pickup_date: string;
  pickup_date_iso?: string | null;
  pickup_time: string;
  transit_time: string;
};

type HotelReservation = {
  section: string;
  airport: string;
  date: string;
  date_iso?: string | null;
  city: string;
  pairing_id: string;
  hotel?: { name: string; address: string; phone: string; confirmation: string } | null;
  transports: HotelTransport[];
};

type HotelData = { source: string; generated_at: string; count: number; reservations: HotelReservation[]; by_date?: Record<string, HotelReservation[]> };

type HotelWeather = {
  status: "ok" | "unavailable" | "out_of_range";
  source: string;
  location: string;
  date: string;
  summary?: string;
  icon?: string;
  tempMin?: number | null;
  tempMax?: number | null;
  precipitationProbability?: number | null;
  precipitationMm?: number | null;
  windKmh?: number | null;
  reason?: string;
};

type FlightStatus = {
  key: string;
  updated_at?: string | null;
  source?: string | null;
  normalized_status?: string | null;
  status?: string | null;
  ident_icao?: string | null;
  ident_iata?: string | null;
  fa_flight_id?: string | null;
  scheduled_out?: string | null;
  estimated_out?: string | null;
  actual_out?: string | null;
  scheduled_off?: string | null;
  estimated_off?: string | null;
  actual_off?: string | null;
  scheduled_on?: string | null;
  estimated_on?: string | null;
  actual_on?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_in?: string | null;
  gate_origin?: string | null;
  gate_destination?: string | null;
  error?: { message?: string; status?: number | null } | null;
};

type FlightStatusData = {
  updated_at?: string | null;
  provider: string;
  usage?: { month?: string | null; queries?: number };
  flights: Record<string, FlightStatus>;
};

type WeatherReport = {
  status: string;
  raw?: string | null;
  reason?: string | null;
};

type BriefingAirport = {
  iata?: string | null;
  icao?: string | null;
  metar?: WeatherReport | null;
  taf?: WeatherReport | null;
  notams?: { status?: string | null; items?: string[] } | null;
};

type FlightBriefing = {
  key: string;
  updated_at?: string | null;
  source?: string | null;
  status?: string | null;
  flight?: { flight_number?: string | null; from?: string | null; to?: string | null; departure_local?: string | null } | null;
  airports?: { origin?: BriefingAirport | null; destination?: BriefingAirport | null; alternates?: BriefingAirport[] } | null;
  lido?: { status?: string | null; notes?: string | null } | null;
  analysis?: { risk?: string | null; summary?: string | null } | null;
};

type FlightBriefingData = {
  updated_at?: string | null;
  provider?: string | null;
  status?: string | null;
  briefings: Record<string, FlightBriefing>;
};

let data = rosterFallback as RosterData;
let hotelData = hotelsFallback as HotelData;
let flightStatusData = flightStatusFallback as FlightStatusData;
let flightBriefingData = flightBriefingFallback as FlightBriefingData;
let hotelReservations = hotelData.reservations || [];
let events = data.events.filter((event) => !event.canceled);
let dataSourceLabel = "Local cache";
let dataUpdatedAt: string | null = data.generated_at || null;
let pendingRosterChanges: RosterPendingChange[] = [];

async function hydrateRuntimeData() {
  const [rosterResult, travelResult, statusResult, briefingResult] = await Promise.all([
    loadRuntimeDocument<RosterData>("roster-latest", rosterFallback as RosterData),
    loadRuntimeDocument<HotelData>("travel", hotelsFallback as HotelData),
    loadRuntimeDocument<FlightStatusData>("flight-status-latest", flightStatusFallback as FlightStatusData),
    loadRuntimeDocument<FlightBriefingData>("flight-briefing-latest", flightBriefingFallback as FlightBriefingData)
  ]);

  data = rosterResult.data;
  hotelData = travelResult.data;
  flightStatusData = statusResult.data;
  flightBriefingData = briefingResult.data;
  hotelReservations = hotelData.reservations || [];
  events = (data.events || []).filter((event) => !event.canceled);
  pendingRosterChanges = data.pending_changes?.status === "pending" ? data.pending_changes.changes || [] : [];
  dataSourceLabel = rosterResult.source === "supabase" ? "Supabase live" : "Local cache";
  dataUpdatedAt = rosterResult.updatedAt || data.generated_at || null;
}
const collator = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

const AIRPORTS: Record<string, string> = {
  VCP: "Viracopos / Campinas",
  CGH: "Congonhas / São Paulo",
  GRU: "Guarulhos / São Paulo",
  SDU: "Santos Dumont / Rio",
  GIG: "Galeão / Rio",
  CNF: "Confins / Belo Horizonte",
  CWB: "Curitiba",
  BSB: "Brasília",
  POA: "Porto Alegre",
  REC: "Recife",
  SSA: "Salvador",
  FOR: "Fortaleza",
  FLN: "Florianópolis",
  IGU: "Foz do Iguaçu",
  MCO: "Orlando",
  LIS: "Lisboa"
};

const HOTEL_WEATHER_LOCATIONS: Record<string, { name: string; latitude: number; longitude: number }> = {
  VCP: { name: "Campinas", latitude: -23.0074, longitude: -47.1345 },
  CGH: { name: "São Paulo", latitude: -23.6261, longitude: -46.6564 },
  GRU: { name: "Guarulhos", latitude: -23.4356, longitude: -46.4731 },
  SDU: { name: "Rio de Janeiro", latitude: -22.91, longitude: -43.1631 },
  GIG: { name: "Rio de Janeiro", latitude: -22.8099, longitude: -43.2506 },
  CNF: { name: "Confins / Belo Horizonte", latitude: -19.6338, longitude: -43.9689 },
  CWB: { name: "São José dos Pinhais / Curitiba", latitude: -25.5285, longitude: -49.1758 },
  BSB: { name: "Brasília", latitude: -15.8711, longitude: -47.9186 },
  POA: { name: "Porto Alegre", latitude: -29.9939, longitude: -51.1711 },
  REC: { name: "Recife", latitude: -8.1265, longitude: -34.9236 },
  SSA: { name: "Salvador", latitude: -12.9086, longitude: -38.3225 },
  FOR: { name: "Fortaleza", latitude: -3.7763, longitude: -38.5326 },
  FLN: { name: "Florianópolis", latitude: -27.6703, longitude: -48.5525 },
  IGU: { name: "Foz do Iguaçu", latitude: -25.6003, longitude: -54.4850 },
  MCO: { name: "Orlando", latitude: 28.4312, longitude: -81.3081 },
  LIS: { name: "Lisboa", latitude: 38.7742, longitude: -9.1342 }
};

const WEATHER_CODE_LABELS: Record<number, { icon: string; label: string }> = {
  0: { icon: "☀️", label: "céu limpo" },
  1: { icon: "🌤️", label: "predomínio de sol" },
  2: { icon: "⛅", label: "parcialmente nublado" },
  3: { icon: "☁️", label: "nublado" },
  45: { icon: "🌫️", label: "nevoeiro" },
  48: { icon: "🌫️", label: "nevoeiro com geada" },
  51: { icon: "🌦️", label: "garoa fraca" },
  53: { icon: "🌦️", label: "garoa" },
  55: { icon: "🌧️", label: "garoa forte" },
  61: { icon: "🌦️", label: "chuva fraca" },
  63: { icon: "🌧️", label: "chuva" },
  65: { icon: "🌧️", label: "chuva forte" },
  80: { icon: "🌦️", label: "pancadas fracas" },
  81: { icon: "🌧️", label: "pancadas de chuva" },
  82: { icon: "⛈️", label: "pancadas fortes" },
  95: { icon: "⛈️", label: "trovoadas" },
  96: { icon: "⛈️", label: "trovoadas com granizo" },
  99: { icon: "⛈️", label: "trovoadas severas" }
};

function airportName(code?: string | null) {
  if (!code) return "—";
  return AIRPORTS[code] || code;
}

function airportLabel(code?: string | null) {
  if (!code) return "—";
  const name = airportName(code);
  return name === code ? code : `${name} (${code})`;
}

function hotelWeatherLocation(reservation: HotelReservation) {
  return HOTEL_WEATHER_LOCATIONS[reservation.airport] || null;
}

function weatherLabel(code?: number | null) {
  if (code === null || code === undefined) return { icon: "🌡️", label: "previsão disponível" };
  return WEATHER_CODE_LABELS[code] || { icon: "🌡️", label: "previsão disponível" };
}

function roundWeatherValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

async function fetchHotelWeather(reservation: HotelReservation): Promise<HotelWeather> {
  const date = reservation.date_iso;
  const location = hotelWeatherLocation(reservation);
  if (!date || !location) {
    return {
      status: "unavailable",
      source: "Open-Meteo",
      location: reservation.city || airportName(reservation.airport),
      date: date || "—",
      reason: "localidade sem coordenadas mapeadas"
    };
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  if (date < today) {
    return {
      status: "out_of_range",
      source: "Open-Meteo",
      location: location.name,
      date,
      reason: "previsão histórica não exibida"
    };
  }

  try {
    const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
    endpoint.searchParams.set("latitude", String(location.latitude));
    endpoint.searchParams.set("longitude", String(location.longitude));
    endpoint.searchParams.set("timezone", "America/Sao_Paulo");
    endpoint.searchParams.set("start_date", date);
    endpoint.searchParams.set("end_date", date);
    endpoint.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max");

    const response = await fetch(endpoint, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        precipitation_sum?: number[];
        wind_speed_10m_max?: number[];
      };
    };
    const index = payload.daily?.time?.indexOf(date) ?? -1;
    if (index < 0) {
      return { status: "out_of_range", source: "Open-Meteo", location: location.name, date, reason: "fora da janela de previsão" };
    }
    const code = payload.daily?.weather_code?.[index] ?? null;
    const label = weatherLabel(code);
    return {
      status: "ok",
      source: "Open-Meteo",
      location: location.name,
      date,
      icon: label.icon,
      summary: label.label,
      tempMax: roundWeatherValue(payload.daily?.temperature_2m_max?.[index]),
      tempMin: roundWeatherValue(payload.daily?.temperature_2m_min?.[index]),
      precipitationProbability: roundWeatherValue(payload.daily?.precipitation_probability_max?.[index]),
      precipitationMm: payload.daily?.precipitation_sum?.[index] ?? null,
      windKmh: roundWeatherValue(payload.daily?.wind_speed_10m_max?.[index])
    };
  } catch (error) {
    return {
      status: "unavailable",
      source: "Open-Meteo",
      location: location.name,
      date,
      reason: error instanceof Error ? error.message : "provider indisponível"
    };
  }
}

async function hotelWeatherByKey(reservations: HotelReservation[]) {
  const unique = new Map<string, HotelReservation>();
  for (const reservation of reservations) {
    const date = reservation.date_iso;
    if (!date) continue;
    const key = `${reservation.airport}-${date}`;
    if (!unique.has(key)) unique.set(key, reservation);
  }
  const entries = await Promise.all([...unique.entries()].map(async ([key, reservation]) => [key, await fetchHotelWeather(reservation)] as const));
  return Object.fromEntries(entries) as Record<string, HotelWeather>;
}

function hotelWeatherKey(reservation: HotelReservation) {
  return `${reservation.airport}-${reservation.date_iso || ""}`;
}

function HotelWeatherLine({ weather }: { weather?: HotelWeather }) {
  if (!weather) return null;
  if (weather.status !== "ok") {
    return <small className="hotelWeather muted">🌡️ Meteo {weather.location}: {weather.reason || "indisponível"}</small>;
  }
  const rain = weather.precipitationProbability !== null && weather.precipitationProbability !== undefined
    ? ` · chuva ${weather.precipitationProbability}%`
    : "";
  const precipitation = weather.precipitationMm !== null && weather.precipitationMm !== undefined && weather.precipitationMm > 0
    ? ` / ${weather.precipitationMm.toFixed(1)} mm`
    : "";
  const wind = weather.windKmh !== null && weather.windKmh !== undefined ? ` · vento ${weather.windKmh} km/h` : "";
  const temp = weather.tempMin !== null && weather.tempMin !== undefined && weather.tempMax !== null && weather.tempMax !== undefined
    ? ` · ${weather.tempMin}°/${weather.tempMax}°C`
    : "";
  return (
    <small className="hotelWeather">
      <b>{weather.icon} Meteo {weather.location}</b>: {weather.summary}{temp}{rain}{precipitation}{wind}
    </small>
  );
}

function airportRoute(from?: string | null, to?: string | null, withCodes = true) {
  const label = withCodes ? airportLabel : airportName;
  if (!from && !to) return "—";
  if (from === to) return label(from);
  return `${label(from)} → ${label(to)}`;
}

function cleanFlightLabel(label: string) {
  return label.replace(/^DHD\s+/i, "").trim();
}

function flightStatusKey(event: RosterEvent) {
  return `${event.date}|${cleanFlightLabel(event.label)}|${event.from}|${event.to}|${event.start_time}`;
}

function flightAwareUrl(event: RosterEvent, status?: FlightStatus | null) {
  const ident = status?.ident_icao || cleanFlightLabel(event.label).replace(/^AD/, "AZU");
  return `https://www.flightaware.com/live/flight/${encodeURIComponent(ident)}`;
}

function flightRadarUrl(event: RosterEvent) {
  return `https://www.flightradar24.com/data/flights/${cleanFlightLabel(event.label).toLowerCase()}`;
}

function flightStatusFor(event: RosterEvent) {
  return flightStatusData.flights?.[flightStatusKey(event)] || null;
}

function flightBriefingFor(event: RosterEvent) {
  return flightBriefingData.briefings?.[flightStatusKey(event)] || null;
}

function timeFromIso(iso?: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function dateTimeFromIso(iso?: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function delayMinutes(scheduled?: string | null, estimated?: string | null, actual?: string | null) {
  const reference = actual || estimated;
  if (!scheduled || !reference) return null;
  const minutes = Math.round((new Date(reference).getTime() - new Date(scheduled).getTime()) / 60000);
  return Math.abs(minutes) >= 5 ? minutes : 0;
}

function flightStatusText(status?: FlightStatus | null) {
  if (!status) return "Status online ainda não consultado";
  if (status.error || status.normalized_status === "unavailable") return "Status online indisponível";
  const labels: Record<string, string> = {
    scheduled: "Programado",
    delayed: "Atrasado",
    airborne: "Em voo",
    landed: "Pousou",
    cancelled: "Cancelado",
    unknown: "A confirmar"
  };
  return labels[status.normalized_status || "unknown"] || status.status || "A confirmar";
}

function FlightLiveInfo({ event }: { event: RosterEvent }) {
  if (event.type !== "FLY") return null;
  const status = flightStatusFor(event);
  const depTime = timeFromIso(status?.actual_off || status?.actual_out || status?.estimated_off || status?.estimated_out);
  const arrTime = timeFromIso(status?.actual_on || status?.actual_in || status?.estimated_on || status?.estimated_in);
  const depDelay = delayMinutes(status?.scheduled_off || status?.scheduled_out, status?.estimated_off || status?.estimated_out, status?.actual_off || status?.actual_out);
  const arrDelay = delayMinutes(status?.scheduled_on || status?.scheduled_in, status?.estimated_on || status?.estimated_in, status?.actual_on || status?.actual_in);
  const delay = arrDelay ?? depDelay;
  return (
    <div className={`flightStatus ${status?.normalized_status || "notFetched"}`}>
      <span>{flightStatusText(status)}</span>
      {depTime && <small>Saída: {depTime}</small>}
      {arrTime && <small>Chegada: {arrTime}</small>}
      {delay !== null && delay !== 0 && <small>{delay > 0 ? `+${delay} min` : `${delay} min`}</small>}
      <a href={flightAwareUrl(event, status)} target="_blank" rel="noreferrer">FlightAware</a>
      <a href={flightRadarUrl(event)} target="_blank" rel="noreferrer">Flightradar24</a>
    </div>
  );
}

function rawReport(report?: WeatherReport | null) {
  if (!report) return "Aguardando consulta";
  if (report.raw) return report.raw;
  if (report.status === "not_found") return "Não encontrado no provider";
  if (report.status === "error") return `Erro: ${report.reason || "provider indisponível"}`;
  return "Indisponível";
}

function AirportBriefingCard({ title, airport }: { title: string; airport?: BriefingAirport | null }) {
  return (
    <div className="briefingAirport">
      <div>
        <strong>{title}</strong>
        <span>{airport?.iata || "—"}{airport?.icao ? ` / ${airport.icao}` : ""}</span>
      </div>
      <dl>
        <dt>METAR</dt>
        <dd>{rawReport(airport?.metar)}</dd>
        <dt>TAF</dt>
        <dd>{rawReport(airport?.taf)}</dd>
        <dt>NOTAM</dt>
        <dd>{airport?.notams?.items?.length ? airport.notams.items.join(" · ") : "Aguardando Lido / fonte oficial"}</dd>
      </dl>
    </div>
  );
}

function PreflightBriefing({ event }: { event: RosterEvent }) {
  const briefing = flightBriefingFor(event);
  if (!briefing) {
    return (
      <article id="briefing" className="moduleCard briefingModule normal">
        <div className="moduleHeader">
          <div>
            <p className="eyebrow">Briefing operacional</p>
            <h2>{cleanFlightLabel(event.label)} · {event.from} → {event.to}</h2>
          </div>
          <span>T-60 min</span>
        </div>
        <div className="briefingMeta">
          <span>Aguardando janela de atualização</span>
          <span>Meteo: AviationWeather.gov</span>
          <span>Lido: pendente</span>
        </div>
        <div className="jarvisAnalysis">
          <strong>Análise JARVIS</strong>
          <p>O briefing automático será gerado cerca de uma hora antes do voo. METAR/TAF entram pelo AviationWeather.gov; alternados e NOTAMs oficiais dependem da extração segura do Lido.</p>
        </div>
      </article>
    );
  }
  const alternates = briefing.airports?.alternates || [];
  return (
    <article id="briefing" className={`moduleCard briefingModule ${briefing.analysis?.risk === "atenção" ? "attention" : "normal"}`}>
      <div className="moduleHeader">
        <div>
          <p className="eyebrow">Briefing operacional</p>
          <h2>{cleanFlightLabel(event.label)} · {event.from} → {event.to}</h2>
        </div>
        <span>{dateTimeFromIso(briefing.updated_at)}</span>
      </div>
      <div className="briefingMeta">
        <span>Fonte meteo: {flightBriefingData.provider || "AviationWeather"}</span>
        <span>Lido: {briefing.lido?.status === "pending_login_automation" ? "pendente" : briefing.lido?.status || "—"}</span>
        <span>Atualiza na janela T-60 min</span>
      </div>
      <div className="briefingAirports">
        <AirportBriefingCard title="Origem" airport={briefing.airports?.origin} />
        <AirportBriefingCard title="Destino" airport={briefing.airports?.destination} />
        {alternates.length > 0
          ? alternates.map((airport, index) => <AirportBriefingCard title={`Alternado ${index + 1}`} airport={airport} key={`${airport.icao}-${index}`} />)
          : <div className="briefingAirport pending"><strong>Alternados</strong><span>Aguardando extração segura do Lido/OFP.</span></div>}
      </div>
      <div className="jarvisAnalysis">
        <strong>Análise JARVIS</strong>
        <p>{briefing.analysis?.summary || "Aguardando dados suficientes para análise."}</p>
      </div>
    </article>
  );
}

const NON_OP_LABELS: Record<string, string> = {
  FR: "Folga regulamentar",
  FP: "Folga pedida",
  LFA: "Liberado por fadiga",
  REA: "Reserva acionada",
  QRH: "Treinamento QRH",
  AVT: "Avaliação técnica"
};

function eventKind(event: RosterEvent) {
  if (event.type === "FLY") return "flight";
  if (event.type === "HOTEL") return "hotel";
  if (event.type === "CHECK") return event.subtype === "IN" ? "checkin" : "checkout";
  if (["OFF", "REST", "DAY_OFF"].includes(event.type) || event.subtype === "OFF") return "off";
  if (event.subtype === "STANDBY") return "standby";
  if (event.subtype === "GROUND") return "training";
  if (event.subtype === "LEAVE") return "leave";
  return "other";
}

function nonOperationalLabel(event: RosterEvent) {
  if (NON_OP_LABELS[event.label]) return NON_OP_LABELS[event.label];
  if (event.label?.startsWith("SB")) return "Sobreaviso";
  if (event.label?.startsWith("RHC")) return "Reserva Hotcrew";
  if (event.subtype === "STANDBY") return event.details || "Reserva / sobreaviso";
  if (event.subtype === "GROUND") return event.details || "Treinamento / atividade";
  if (event.subtype === "LEAVE") return event.details || "Liberação";
  if (event.subtype === "OFF") return event.details || "Folga";
  return event.details || event.type;
}

function kindLabel(event: RosterEvent) {
  if (event.type === "NON_OP") return nonOperationalLabel(event);
  const kind = eventKind(event);
  const labels: Record<string, string> = {
    flight: "Voo",
    hotel: "Hotel",
    checkin: "Apresentação",
    checkout: "Release",
    off: "Folga",
    standby: "Reserva / sobreaviso",
    training: "Treinamento / atividade",
    leave: "Liberação",
    other: event.type
  };
  return labels[kind];
}

function eventOneLine(event?: RosterEvent | null) {
  if (!event) return "—";
  return [
    `${event.start_time || "—"}–${event.end_time || "—"}`,
    event.label,
    shortAirport(event),
    event.details
  ].filter(Boolean).join(" · ");
}

function pendingChangeLabel(type: RosterPendingChange["type"]) {
  if (type === "added") return "Adicionado";
  if (type === "removed") return "Removido";
  return "Alterado";
}

function pendingChangesForDay(day: string) {
  return pendingRosterChanges.filter((change) => change.date === day);
}

function PendingChangesPanel({ changes, compact = false }: { changes: RosterPendingChange[]; compact?: boolean }) {
  if (!changes.length) return null;
  return (
    <div className={`pendingChangesPanel ${compact ? "compact" : ""}`}>
      <div className="pendingChangesTitle">
        <strong>⚠️ Alteração pendente no CAE</strong>
        <span>Informativo apenas · não confirmado/aceito</span>
      </div>
      {changes.slice(0, compact ? 2 : 8).map((change) => (
        <div className={`pendingChangeItem ${change.type}`} key={`${change.type}-${change.id}`}>
          <span className="pendingChangeBadge">{pendingChangeLabel(change.type)}</span>
          <div>
            {change.type !== "added" && <p><b>Atual:</b> {eventOneLine(change.current)}</p>}
            {change.type !== "removed" && <p><b>Proposto:</b> {eventOneLine(change.proposed)}</p>}
          </div>
        </div>
      ))}
      {changes.length > (compact ? 2 : 8) && <small>+ {changes.length - (compact ? 2 : 8)} alteração(ões) no período.</small>}
    </div>
  );
}

function parseDate(date: string) {
  return new Date(`${date}T12:00:00-03:00`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const next = parseDate(date);
  next.setDate(next.getDate() + amount);
  return isoDate(next);
}

function eachDate(start: string, end: string) {
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function currentMonthRange(todayKey: string) {
  const [year, month] = todayKey.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(parseDate(date));
}

function runtimeUpdatedLabel(value?: string | null) {
  if (!value) return "Atualização n/d";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Atualização n/d";
  return `Atualizado: ${new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)}`;
}

function dashboardMessage(searchParams: Record<string, string | string[] | undefined>) {
  const refresh = typeof searchParams.roster_refresh === "string" ? searchParams.roster_refresh : "";
  const error = typeof searchParams.error === "string" ? searchParams.error : "";
  if (refresh === "queued") return "Atualização da escala solicitada. Aguarde alguns instantes e recarregue a página.";
  if (refresh === "failed") return "Não consegui enfileirar a atualização da escala. Verifique a configuração do Supabase.";
  if (error === "forbidden") return "Ação restrita ao Danilo/JARVIS.";
  return null;
}

function shortAirport(event: RosterEvent) {
  return airportRoute(event.from, event.to);
}

function groupByDay(items: RosterEvent[]) {
  return items.reduce<Record<string, RosterEvent[]>>((acc, event) => {
    acc[event.date] ||= [];
    acc[event.date].push(event);
    return acc;
  }, {});
}

function durationMinutes(event: RosterEvent) {
  const start = new Date(event.start_local).getTime();
  const end = new Date(event.end_local).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}


function transportLabel(direction: string) {
  return direction === "to_hotel" ? "Busca no aeroporto" : "Busca no hotel";
}

function timeToMinutes(time?: string | null) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function transitMinutes(transit?: string | null) {
  const match = String(transit || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function arrivalAtHotel(transport?: HotelTransport) {
  const pickup = timeToMinutes(transport?.pickup_time);
  if (pickup === null) return null;
  return minutesToTime(pickup + transitMinutes(transport?.transit_time));
}

function overnightWindow(reservation: HotelReservation) {
  const toHotel = reservation.transports.find((transport) => transport.direction === "to_hotel");
  const toAirport = reservation.transports.find((transport) => transport.direction === "to_airport");
  const arrival = arrivalAtHotel(toHotel) || toHotel?.pickup_time || null;
  const pickup = toAirport?.pickup_time || null;
  if (!arrival && !pickup) return null;
  return { arrival, pickup, pickupDate: toAirport?.pickup_date_iso || null, pickupCompany: toAirport?.company || null };
}

function overnightText(reservation: HotelReservation) {
  const window = overnightWindow(reservation);
  if (!window) return null;
  if (window.arrival && window.pickup) return `Transporte: deixa aprox. ${window.arrival} · esteja pronto ${window.pickup}`;
  if (window.pickup) return `Esteja pronto ${window.pickup}`;
  return `Transporte: deixa aprox. ${window.arrival}`;
}

function displayEvents(dayEvents: RosterEvent[]) {
  return dayEvents.filter((event) => event.type !== "HOTEL");
}

function hotelsForDay(day: string) {
  return hotelReservations
    .map((reservation) => ({
      reservation,
      transports: reservation.transports.filter((transport) => transport.pickup_date_iso === day || reservation.date_iso === day && transport.direction === "to_hotel")
    }))
    .filter((item) => item.reservation.date_iso === day || item.transports.length);
}

function firstTime(times: string[]) {
  return times.filter(Boolean).sort()[0];
}

function lastTime(times: string[]) {
  return times.filter(Boolean).sort().at(-1);
}

function operationalWindow(dayEvents: RosterEvent[], day: string) {
  const dayHotels = hotelsForDay(day);
  const toAirport = dayHotels.flatMap(({ transports }) =>
    transports.filter((transport) => transport.direction === "to_airport" && transport.pickup_date_iso === day).map((transport) => transport.pickup_time)
  );
  const toHotel = dayHotels.flatMap(({ transports }) =>
    transports.filter((transport) => transport.direction === "to_hotel" && transport.pickup_date_iso === day).map((transport) => transport.pickup_time)
  );
  const flights = dayEvents.filter((event) => event.type === "FLY");
  const checkIn = dayEvents.find((event) => event.type === "CHECK" && event.subtype === "IN");
  const activeEvents = dayEvents.filter((event) => event.type !== "HOTEL");
  return {
    start: firstTime(toAirport) || checkIn?.start_time || activeEvents[0]?.start_time || dayEvents[0]?.start_time || "—",
    end: lastTime(toHotel) || flights.at(-1)?.end_time || activeEvents.at(-1)?.end_time || dayEvents.at(-1)?.end_time || "—",
    source: toAirport.length || toHotel.length ? "transporte" : "escala"
  };
}

function daySummary(dayEvents: RosterEvent[]) {
  const flights = dayEvents.filter((event) => event.type === "FLY");
  const hotels = dayEvents.filter((event) => event.type === "HOTEL");
  const first = dayEvents[0];
  const last = dayEvents[dayEvents.length - 1];
  const route = flights.length
    ? [flights[0].from, ...flights.map((flight) => flight.to)].filter(Boolean).map((code) => airportName(code)).join(" → ")
    : airportRoute(first?.from, first?.to, false);
  return { flights, hotels, first, last, route };
}

function transportDateTime(transport: HotelTransport) {
  if (!transport.pickup_date_iso || !transport.pickup_time) return null;
  return new Date(`${transport.pickup_date_iso}T${transport.pickup_time}:00-03:00`);
}

type AgendaItem = {
  id: string;
  sortAt: Date;
  date: string;
  time: string;
  label: string;
  detail: string;
  category: string;
  priority: number;
};

function getAgendaItems(todayKey: string, daysAhead = 21) {
  const startKey = todayKey;
  const endKey = addDays(todayKey, daysAhead);
  const rosterItems: AgendaItem[] = events
    .filter((event) => event.type !== "HOTEL" && event.date >= startKey && event.date <= endKey)
    .map((event) => ({
      id: `roster-${event.id}`,
      sortAt: new Date(event.start_local),
      label: event.label,
      date: event.date,
      time: `${event.start_time} → ${event.end_time}`,
      detail: event.details || shortAirport(event),
      category: kindLabel(event),
      priority: event.type === "CHECK" && event.subtype === "IN" ? 1 : event.type === "FLY" ? 2 : 4
    }));

  const transportItems: AgendaItem[] = hotelReservations.flatMap((reservation) =>
    reservation.transports.map((transport, index) => {
      const sortAt = transportDateTime(transport);
      const date = transport.pickup_date_iso || reservation.date_iso || "";
      if (!sortAt || !date || date < startKey || date > endKey) return null;
      const isPickup = transport.direction === "to_airport";
      return {
        id: `transport-${reservation.airport}-${date}-${transport.pickup_time}-${index}`,
        sortAt,
        label: isPickup ? "Esteja pronto para a van" : "Van para o hotel",
        date,
        time: transport.pickup_time,
        detail: `${airportLabel(reservation.airport)} · ${transport.company}`,
        category: "Transporte",
        priority: isPickup ? 0 : 3
      };
    }).filter((item): item is AgendaItem => item !== null)
  );

  const hotelItems: AgendaItem[] = hotelReservations
    .map((reservation, index) => {
      const date = reservation.date_iso || "";
      if (!date || date < startKey || date > endKey) return null;
      return {
        id: `hotel-${reservation.airport}-${date}-${index}`,
        sortAt: parseDate(date),
        label: reservation.hotel?.name || "Pernoite",
        date,
        time: "Hotel",
        detail: `${airportLabel(reservation.airport)} · ${reservation.hotel?.address || reservation.city}`,
        category: "Pernoite",
        priority: 5
      };
    })
    .filter((item): item is AgendaItem => item !== null);

  return [...transportItems, ...rosterItems, ...hotelItems]
    .filter((item) => Number.isFinite(item.sortAt.getTime()))
    .sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime() || a.priority - b.priority || a.label.localeCompare(b.label));
}

function groupAgendaItems(items: AgendaItem[]) {
  return items.reduce<Record<string, AgendaItem[]>>((acc, item) => {
    acc[item.date] ||= [];
    acc[item.date].push(item);
    return acc;
  }, {});
}

function getUpcoming() {
  const now = new Date();
  const rosterItems = events
    .filter((event) => event.type !== "HOTEL")
    .map((event) => ({
      sortAt: new Date(event.end_local),
      label: event.label,
      date: event.date,
      time: `${event.start_time} → ${event.end_time}`,
      detail: shortAirport(event),
      priority: event.type === "CHECK" && event.subtype === "IN" ? 1 : 2
    }));
  const transportItems = hotelReservations.flatMap((reservation) =>
    reservation.transports.map((transport) => {
      const sortAt = transportDateTime(transport);
      if (!sortAt) return null;
      const isPickup = transport.direction === "to_airport";
      return {
        sortAt,
        label: isPickup ? "Esteja pronto para a van" : "Van para o hotel",
        date: transport.pickup_date_iso || reservation.date_iso || "",
        time: transport.pickup_time,
        detail: `${airportLabel(reservation.airport)} · ${transport.company}`,
        priority: isPickup ? 0 : 3
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null)
  );
  const upcoming = [...rosterItems, ...transportItems]
    .filter((item) => item.sortAt >= now)
    .sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime() || a.priority - b.priority)[0];
  return upcoming || rosterItems[0] || null;
}

function statCards(monthStart: string, monthEnd: string) {
  const visibleEvents = events.filter((event) => event.date >= monthStart && event.date <= monthEnd);
  const eventDays = new Set(visibleEvents.map((event) => event.date));
  const hiddenDays = eachDate(monthStart, monthEnd).filter((day) => !eventDays.has(day));
  const flightEvents = visibleEvents.filter((event) => event.type === "FLY");
  const hotelEvents = hotelReservations.filter((reservation) =>
    (reservation.date_iso && reservation.date_iso >= monthStart && reservation.date_iso <= monthEnd) ||
    reservation.transports.some((transport) => transport.pickup_date_iso && transport.pickup_date_iso >= monthStart && transport.pickup_date_iso <= monthEnd)
  );
  const airports = new Set(flightEvents.flatMap((event) => [event.from, event.to].filter(Boolean)));
  const blockMinutes = flightEvents.reduce((sum, event) => sum + durationMinutes(event), 0);
  const period = monthLabel(monthStart);
  return [
    { label: "Voos", value: String(flightEvents.length), hint: `em ${period}` },
    { label: "Hotéis", value: String(hotelEvents.length), hint: `em ${period}` },
    { label: "Dias ocultos", value: String(hiddenDays.length), hint: `em ${period}` },
    { label: "Tempo em voo", value: formatDuration(blockMinutes), hint: `em ${period}` }
  ];
}

function latestBriefedFlight() {
  const flightEvents = events.filter((event) => event.type === "FLY" && flightBriefingFor(event));
  return flightEvents
    .sort((a, b) => new Date(a.start_local).getTime() - new Date(b.start_local).getTime())
    .find((event) => new Date(event.end_local) >= new Date()) || flightEvents.at(-1) || null;
}

export default async function Home({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const params = searchParams ? await searchParams : {};
  const message = dashboardMessage(params);

  const canViewBriefing = hasModule(user, "briefing");
  const canViewAgenda = hasModule(user, "agenda");
  const canViewFinances = hasModule(user, "financas");
  const canViewTravel = hasModule(user, "viagens");
  const canViewAdmin = isAdmin(user);

  await hydrateRuntimeData();
  const hotelWeather = await hotelWeatherByKey(hotelReservations);

  const grouped = groupByDay(events);
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const { start: monthStart, end: monthEnd } = currentMonthRange(todayKey);
  const monthDays = eachDate(monthStart, monthEnd);
  const firstTodayOrFuture = monthDays.find((day) => day >= todayKey) || monthDays[0];
  const upcomingDays = monthDays.filter((day) => day >= todayKey);
  const pastDays = monthDays.filter((day) => day < todayKey).reverse();
  const days = upcomingDays.length ? upcomingDays : monthDays.slice(-1);
  const focusDay = firstTodayOrFuture || monthDays[0];
  const focusEvents = grouped[focusDay] || [];
  const pendingFocusChanges = pendingChangesForDay(focusDay);
  const pendingDates = new Set(pendingRosterChanges.map((change) => change.date).filter(Boolean));
  const focusSummary = focusEvents.length ? daySummary(focusEvents) : null;
  const focusWindow = focusEvents.length ? operationalWindow(focusEvents, focusDay) : { start: "—", end: "—", source: "oculto" };
  const focusHotels = hotelsForDay(focusDay);
  const upcoming = getUpcoming();
  const briefingFlight = latestBriefedFlight() || focusEvents.find((event) => event.type === "FLY") || null;

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="brandMark small">J</div>
          <div>
            <strong>JARVIS</strong>
            <span>Operações pessoais</span>
          </div>
        </div>
        <nav className="navList" aria-label="Módulos">
          <a className="navItem active" href="#escala">Escala</a>
          {canViewBriefing && <a className="navItem" href="#briefing">Briefing</a>}
          {canViewAgenda && <a className="navItem" href="/agenda">Agenda</a>}
          {canViewFinances && <a className="navItem disabled" aria-disabled="true">Finanças</a>}
          {canViewTravel && <a className="navItem disabled" aria-disabled="true">Viagens</a>}
          {canViewAdmin && <a className="navItem" href="/admin">Admin</a>}
        </nav>
        <div className="sidebarFooter">
          <span>Logado como</span>
          <strong>{user.name}</strong>
          <form action="/api/logout" method="post">
            <button className="ghostButton" type="submit">Sair</button>
          </form>
        </div>
      </aside>

      <section className="contentShell">
        <header className="dashboardHeader">
          <div>
            <p className="eyebrow">Escala Azul · Danilo Fiorotto</p>
            <h1>Próximas viagens</h1>
            <p className="muted">
              Mostrando o mês atual fechado. Dias passados ficam escondidos para não poluir.
            </p>
          </div>
          <div className="statusStack">
            <div className="statusChip">Hoje: {new Date(`${todayKey}T12:00:00-03:00`).toLocaleDateString("pt-BR")}</div>
            <div className="statusChip">Dados: {dataSourceLabel} · {runtimeUpdatedLabel(dataUpdatedAt)}</div>
            {pendingRosterChanges.length > 0 && <div className="statusChip warning">⚠️ {pendingRosterChanges.length} alteração(ões) pendente(s)</div>}
            <div className="periodChip">{monthLabel(monthStart)} · {shortDate.format(parseDate(monthStart))}–{shortDate.format(parseDate(monthEnd))}</div>
            {canViewAdmin && (
              <form action="/api/roster/refresh" method="post" className="inlineForm">
                <button className="ghostButton" type="submit">Atualizar escala</button>
              </form>
            )}
          </div>
        </header>

        {message && <section className="panelCard"><p>{message}</p></section>}

        {pendingRosterChanges.length > 0 && (
          <section className="pendingRosterBanner">
            <div>
              <strong>Modificação pendente detectada no CAE</strong>
              <span>O painel abaixo mostra a escala publicada como base e destaca o que aparece como proposta/pendência. Nenhuma confirmação, aceite ou alteração operacional é feita pelo site.</span>
            </div>
            <a href="#alteracoes-pendentes">Ver alterações</a>
          </section>
        )}

        <section className="moduleGrid">
          <article id="escala" className="moduleCard scheduleModule">
            <div className="moduleHeader">
              <div>
                <p className="eyebrow">Escala</p>
                <h2>{focusDay === todayKey ? "Hoje" : "Próximo dia com escala"}</h2>
              </div>
              <span>{focusDay ? longDate.format(parseDate(focusDay)) : "—"}</span>
            </div>

            {focusSummary && (
              <div className="todayPanel">
                <div>
                  <strong>{focusSummary.route}</strong>
                  <span>{focusSummary.flights.length} voo(s) · {focusSummary.hotels.length ? "com hotel" : "sem hotel"}</span>
                </div>
                <div className="todayTimes">
                  <span>Começo</span><strong>{focusWindow.start}</strong>
                  <span>Fim</span><strong>{focusWindow.end}</strong>
                </div>
              </div>
            )}

            <PendingChangesPanel changes={pendingFocusChanges} />

            {focusHotels.length > 0 && (
              <div className="dayHotelBlock">
                {focusHotels.map(({ reservation, transports }) => (
                  <div className="dayHotelItem" key={`${reservation.airport}-${reservation.date}-${reservation.hotel?.name}`}>
                    <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
                    <span>{reservation.hotel?.address || reservation.city}</span>
                    <HotelWeatherLine weather={hotelWeather[hotelWeatherKey(reservation)]} />
                    {overnightText(reservation) && (
                      <small className="overnightWindow">
                        {overnightText(reservation)}
                      </small>
                    )}
                    {transports.map((transport) => (
                      <small key={`${transport.direction}-${transport.pickup_time}`}>
                        {transportLabel(transport.direction)}: {transport.pickup_time} · {transport.company}
                      </small>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="compactEvents">
              {displayEvents(focusEvents).map((event) => (
                <div className={`compactEvent ${eventKind(event)}`} key={event.id}>
                  <time>{event.start_time}</time>
                  <div>
                    <strong>{event.label}</strong>
                    <span>{kindLabel(event)} · {shortAirport(event)}</span>
                    <FlightLiveInfo event={event} />
                  </div>
                  <small>{kindLabel(event)}</small>
                </div>
              ))}
            </div>
          </article>

          {canViewAgenda && (
            <article id="agenda" className="moduleCard nextModule">
              <p className="eyebrow">Agenda</p>
              <h2>{upcoming ? upcoming.label : "Sem compromissos"}</h2>
              {upcoming ? (
                <>
                  <p>{longDate.format(parseDate(upcoming.date))}</p>
                  <strong>{upcoming.time}</strong>
                  <span>{upcoming.detail}</span>
                </>
              ) : (
                <span className="muted">Nenhum compromisso publicado no período.</span>
              )}
            </article>
          )}

          {statCards(monthStart, monthEnd).map((stat) => (
            <article className="moduleCard miniStat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.hint}</small>
            </article>
          ))}

          {canViewBriefing && briefingFlight && <PreflightBriefing event={briefingFlight} />}

          {pendingRosterChanges.length > 0 && (
            <article id="alteracoes-pendentes" className="moduleCard pendingRosterModule">
              <div className="moduleHeader">
                <div>
                  <p className="eyebrow">CAE informativo</p>
                  <h2>Alterações pendentes</h2>
                </div>
                <span>{pendingRosterChanges.length} item(ns)</span>
              </div>
              <PendingChangesPanel changes={pendingRosterChanges} />
            </article>
          )}

        </section>


        <section className="timeline compactTimeline">
          <div className="sectionTitle">
            <div>
              <p className="eyebrow">Linha do tempo</p>
              <h2>Próximos dias</h2>
            </div>
            <span className="muted">Mês atual fechado; datas passadas ficam recolhidas.</span>
          </div>
          <div className="daysList compactDays">
            {days.map((day) => {
              const dayEvents = grouped[day] || [];
              const isHiddenDay = dayEvents.length === 0;
              const summary = isHiddenDay ? null : daySummary(dayEvents);
              const dayHotels = hotelsForDay(day);
              return (
                <article className={`dayCard ${day === focusDay ? "focus" : ""} ${isHiddenDay ? "hiddenDay" : ""} ${pendingDates.has(day) ? "hasPendingChange" : ""}`} key={day}>
                  <div className="dayHeader">
                    <div>
                      <time>{day === todayKey ? "Hoje" : collator.format(parseDate(day))}</time>
                      <strong>{isHiddenDay ? "Dia oculto" : summary?.route}</strong>
                    </div>
                    <span>{pendingDates.has(day) ? "pendente no CAE" : isHiddenDay ? "sem alocação" : summary?.flights.length ? `${summary.flights.length} voo(s)` : kindLabel(dayEvents[0])}</span>
                  </div>
                  <PendingChangesPanel changes={pendingChangesForDay(day)} compact />
                  {isHiddenDay && <div className="hiddenDayNote">Nenhum voo, folga ou atividade publicada para este dia.</div>}
                  {!isHiddenDay && <div className="eventList reduced">
                    {displayEvents(dayEvents).slice(0, 5).map((event) => (
                      <div className={`eventRow ${eventKind(event)}`} key={event.id}>
                        <div className="timeBlock">
                          <strong>{event.start_time}</strong>
                          <span>{event.end_time}</span>
                        </div>
                        <div className="eventMain">
                          <div>
                            <strong>{event.label}</strong>
                            <span>{kindLabel(event)} · {shortAirport(event)}</span>
                          </div>
                          <FlightLiveInfo event={event} />
                        </div>
                      </div>
                    ))}
                    {displayEvents(dayEvents).length > 5 && <div className="moreEvents">+ {displayEvents(dayEvents).length - 5} eventos no dia</div>}
                  </div>}
                  {dayHotels.length > 0 && (
                    <div className="embeddedHotels">
                      {dayHotels.map(({ reservation, transports }) => (
                        <div className="embeddedHotel" key={`${day}-${reservation.airport}-${reservation.hotel?.name}`}>
                          <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
                          <HotelWeatherLine weather={hotelWeather[hotelWeatherKey(reservation)]} />
                          {overnightText(reservation) && (
                            <span className="overnightWindow">
                              {overnightText(reservation)}
                            </span>
                          )}
                          {transports.map((transport) => (
                            <span key={`${transport.direction}-${transport.pickup_time}`}>
                              {transportLabel(transport.direction)}: {transport.pickup_time} · {transport.company}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {pastDays.length > 0 && (
            <details className="pastTrips">
              <summary>Mostrar datas passadas ({pastDays.length})</summary>
              <div className="daysList compactDays pastDays">
                {pastDays.map((day) => {
                  const dayEvents = grouped[day] || [];
                  const isHiddenDay = dayEvents.length === 0;
                  const summary = isHiddenDay ? null : daySummary(dayEvents);
                  const dayHotels = hotelsForDay(day);
                  return (
                    <article className={`dayCard past ${isHiddenDay ? "hiddenDay" : ""} ${pendingDates.has(day) ? "hasPendingChange" : ""}`} key={day}>
                      <div className="dayHeader">
                        <div>
                          <time>{collator.format(parseDate(day))}</time>
                          <strong>{isHiddenDay ? "Dia oculto" : summary?.route}</strong>
                        </div>
                        <span>{pendingDates.has(day) ? "pendente no CAE" : isHiddenDay ? "sem alocação" : summary?.flights.length ? `${summary.flights.length} voo(s)` : kindLabel(dayEvents[0])}</span>
                      </div>
                      <PendingChangesPanel changes={pendingChangesForDay(day)} compact />
                      {isHiddenDay && <div className="hiddenDayNote">Nenhum voo, folga ou atividade publicada para este dia.</div>}
                      {!isHiddenDay && <div className="eventList reduced">
                        {displayEvents(dayEvents).slice(0, 5).map((event) => (
                          <div className={`eventRow ${eventKind(event)}`} key={event.id}>
                            <div className="timeBlock">
                              <strong>{event.start_time}</strong>
                              <span>{event.end_time}</span>
                            </div>
                            <div className="eventMain">
                              <div>
                                <strong>{event.label}</strong>
                                <span>{kindLabel(event)} · {shortAirport(event)}</span>
                              </div>
                              <FlightLiveInfo event={event} />
                            </div>
                          </div>
                        ))}
                        {displayEvents(dayEvents).length > 5 && <div className="moreEvents">+ {displayEvents(dayEvents).length - 5} eventos no dia</div>}
                      </div>}
                      {dayHotels.length > 0 && (
                        <div className="embeddedHotels">
                          {dayHotels.map(({ reservation, transports }) => (
                            <div className="embeddedHotel" key={`${day}-${reservation.airport}-${reservation.hotel?.name}`}>
                              <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
                              <HotelWeatherLine weather={hotelWeather[hotelWeatherKey(reservation)]} />
                              {transports.map((transport) => (
                                <span key={`${transport.direction}-${transport.pickup_time}`}>
                                  {transportLabel(transport.direction)}: {transport.pickup_time} · {transport.company}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </details>
          )}
        </section>
      </section>
    </main>
  );
}
