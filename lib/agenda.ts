import crypto from "crypto";
import rosterFallback from "../app/data/roster-latest.json";
import hotelsFallback from "../app/data/hotels-latest.json";
import { AppUser, isAdmin } from "./auth";
import { loadRuntimeDocument } from "./runtime-data";

export type AgendaStatus = "approved" | "pending" | "rejected";
export type AgendaSource = "manual" | "jarvis" | "roster";
export type AgendaVisibility = "shared" | "private";

export type AgendaEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  address?: string | null;
  status: AgendaStatus;
  visibility: AgendaVisibility;
  source: AgendaSource;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  recurrenceRule?: string | null;
  reminderMinutesBefore?: number[];
  createdAt: string;
  updatedAt: string;
};

export type AgendaOccurrence = AgendaEvent & {
  occurrenceId: string;
  baseEventId: string;
  originalStartsAt: string;
  originalEndsAt: string;
  isOccurrence: boolean;
  readonly: boolean;
};

type AgendaDocument = {
  version: 1;
  events: AgendaEvent[];
};

type RuntimeDocument<T> = {
  doc_key: string;
  payload: T;
  updated_at?: string | null;
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
  canceled?: boolean;
};

type RosterData = { events: RosterEvent[] };

type HotelTransport = {
  direction: string;
  pickup_date_iso?: string | null;
  pickup_time: string;
};

type HotelReservation = {
  airport: string;
  date_iso?: string | null;
  transports: HotelTransport[];
};

type HotelData = { reservations: HotelReservation[] };

const AGENDA_DOC_KEY = "agenda-events";
const DOCUMENT_TABLE = process.env.SUPABASE_DOCUMENTS_TABLE || "jarvis_site_documents";
const SAO_PAULO_OFFSET = "-03:00";

function supabaseAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  return { url, serviceRoleKey, anonKey };
}

async function fetchDocument<T>(docKey: string, fallback: T): Promise<T> {
  const { url, serviceRoleKey, anonKey } = supabaseAdminConfig();
  const key = serviceRoleKey || anonKey;
  if (!url || !key) return fallback;
  const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
  endpoint.searchParams.set("doc_key", `eq.${docKey}`);
  endpoint.searchParams.set("select", "doc_key,payload,updated_at");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) return fallback;
  const rows = (await response.json()) as RuntimeDocument<T>[];
  return rows[0]?.payload || fallback;
}

async function saveDocument<T>(docKey: string, payload: T) {
  const { url, serviceRoleKey } = supabaseAdminConfig();
  if (!url || !serviceRoleKey) throw new Error("supabase_service_role_missing");
  const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ doc_key: docKey, payload, source: "jarvis-agenda" })
  });
  if (!response.ok) throw new Error(`supabase_agenda_save_${response.status}`);
}

export async function loadAgendaEvents() {
  const doc = await fetchDocument<AgendaDocument>(AGENDA_DOC_KEY, { version: 1, events: [] });
  return Array.isArray(doc.events) ? doc.events : [];
}

export async function saveAgendaEvents(events: AgendaEvent[]) {
  await saveDocument<AgendaDocument>(AGENDA_DOC_KEY, { version: 1, events });
}

export function localDateTimeToIso(value: string) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}${SAO_PAULO_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function toLocalInputValue(iso: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso)).replace(" ", "T");
}

export function formatAgendaTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function formatAgendaDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(new Date(iso));
}

export function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function startOfSaoPauloDay(key: string) {
  return new Date(`${key}T00:00:00${SAO_PAULO_OFFSET}`);
}

export function endOfSaoPauloDay(key: string) {
  return new Date(`${key}T23:59:59${SAO_PAULO_OFFSET}`);
}

export function makeRecurrenceRule(frequency: string, intervalRaw: string, untilRaw: string) {
  if (!frequency || frequency === "none") return null;
  const allowed = new Set(["DAILY", "WEEKLY", "MONTHLY"]);
  if (!allowed.has(frequency)) return null;
  const interval = Math.max(1, Math.min(52, Number(intervalRaw || 1) || 1));
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (untilRaw) {
    const until = localDateTimeToIso(`${untilRaw}T23:59`);
    if (until) parts.push(`UNTIL=${until.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  }
  return parts.join(";");
}

function parseRecurrence(rule?: string | null) {
  if (!rule) return null;
  return Object.fromEntries(rule.split(";").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  })) as Record<string, string>;
}

function addRecurrenceStep(date: Date, freq: string, interval: number) {
  const next = new Date(date);
  if (freq === "DAILY") next.setDate(next.getDate() + interval);
  if (freq === "WEEKLY") next.setDate(next.getDate() + interval * 7);
  if (freq === "MONTHLY") next.setMonth(next.getMonth() + interval);
  return next;
}

export function expandAgendaEvents(events: AgendaEvent[], rangeStart: Date, rangeEnd: Date) {
  const occurrences: AgendaOccurrence[] = [];
  for (const event of events) {
    if (event.status === "rejected") continue;
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    const duration = end.getTime() - start.getTime();
    const recurrence = parseRecurrence(event.recurrenceRule);
    if (!recurrence) {
      if (end >= rangeStart && start <= rangeEnd) {
        occurrences.push({ ...event, occurrenceId: event.id, baseEventId: event.id, originalStartsAt: event.startsAt, originalEndsAt: event.endsAt, isOccurrence: false, readonly: event.source === "roster" });
      }
      continue;
    }

    const freq = recurrence.FREQ;
    const interval = Math.max(1, Number(recurrence.INTERVAL || 1) || 1);
    const until = recurrence.UNTIL ? new Date(recurrence.UNTIL.replace(/(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")) : rangeEnd;
    let cursor = new Date(start);
    let guard = 0;
    while (cursor <= rangeEnd && cursor <= until && guard < 730) {
      const occurrenceEnd = new Date(cursor.getTime() + duration);
      if (occurrenceEnd >= rangeStart && cursor <= rangeEnd) {
        const occurrenceStartsAt = cursor.toISOString();
        occurrences.push({
          ...event,
          startsAt: occurrenceStartsAt,
          endsAt: occurrenceEnd.toISOString(),
          occurrenceId: `${event.id}:${occurrenceStartsAt}`,
          baseEventId: event.id,
          originalStartsAt: event.startsAt,
          originalEndsAt: event.endsAt,
          isOccurrence: occurrenceStartsAt !== event.startsAt,
          readonly: event.source === "roster"
        });
      }
      cursor = addRecurrenceStep(cursor, freq, interval);
      guard += 1;
    }
  }
  return occurrences.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function transportDateTime(transport: HotelTransport) {
  if (!transport.pickup_date_iso || !transport.pickup_time) return null;
  const date = new Date(`${transport.pickup_date_iso}T${transport.pickup_time}:00${SAO_PAULO_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstTransportDate(transports: HotelTransport[], direction: string) {
  return transports
    .filter((transport) => transport.direction === direction)
    .map(transportDateTime)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

function lastTransportDate(transports: HotelTransport[], direction: string) {
  return transports
    .filter((transport) => transport.direction === direction)
    .map(transportDateTime)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

export async function rosterAgendaBlocks(rangeStart: Date, rangeEnd: Date): Promise<AgendaEvent[]> {
  const [rosterResult, travelResult] = await Promise.all([
    loadRuntimeDocument<RosterData>("roster-latest", rosterFallback as RosterData),
    loadRuntimeDocument<HotelData>("travel", hotelsFallback as HotelData)
  ]);
  const rosterEvents = (rosterResult.data.events || []).filter((event) => !event.canceled);
  const reservations = travelResult.data.reservations || [];
  const byDate = rosterEvents.reduce<Record<string, RosterEvent[]>>((acc, event) => {
    acc[event.date] ||= [];
    acc[event.date].push(event);
    return acc;
  }, {});

  return Object.entries(byDate).flatMap(([day, dayEvents]) => {
    const flights = dayEvents.filter((event) => event.type === "FLY");
    if (!flights.length) return [];
    const checkIn = dayEvents.find((event) => event.type === "CHECK" && event.subtype === "IN");
    const lastActive = dayEvents.filter((event) => event.type !== "HOTEL").sort((a, b) => new Date(a.end_local).getTime() - new Date(b.end_local).getTime()).at(-1);
    const relatedReservations = reservations.filter((reservation) => reservation.date_iso === day || reservation.transports.some((transport) => transport.pickup_date_iso === day));
    const transports = relatedReservations.flatMap((reservation) => reservation.transports || []);
    const toAirport = firstTransportDate(transports, "to_airport");
    const toHotel = lastTransportDate(transports, "to_hotel");
    const start = toAirport || new Date(checkIn?.start_local || flights[0].start_local);
    const end = toHotel || new Date(lastActive?.end_local || flights.at(-1)?.end_local || flights[0].end_local);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end < rangeStart || start > rangeEnd) return [];
    return [{
      id: `roster-${day}-${crypto.createHash("sha1").update(flights.map((flight) => flight.id).join("|")).digest("hex").slice(0, 12)}`,
      title: "Voo",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      description: `Bloqueio automático da escala: ${flights.map((flight) => flight.label).join(", ")}`,
      address: null,
      status: "approved" as AgendaStatus,
      visibility: "shared" as AgendaVisibility,
      source: "roster" as AgendaSource,
      createdBy: "jarvis",
      approvedBy: "jarvis",
      approvedAt: new Date().toISOString(),
      recurrenceRule: null,
      reminderMinutesBefore: [],
      createdAt: start.toISOString(),
      updatedAt: new Date().toISOString()
    }];
  });
}

export function intervalConflicts(startIso: string, endIso: string, occurrences: AgendaOccurrence[], excludeBaseEventId?: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return occurrences.filter((event) => {
    if (excludeBaseEventId && event.baseEventId === excludeBaseEventId) return false;
    if (event.status !== "approved") return false;
    const eventStart = new Date(event.startsAt).getTime();
    const eventEnd = new Date(event.endsAt).getTime();
    return start < eventEnd && end > eventStart;
  });
}

export function canSeeDetails(user: AppUser, event: AgendaOccurrence | AgendaEvent) {
  return isAdmin(user) || event.createdBy.toLowerCase() === user.username.toLowerCase();
}

export function publicEventFor(user: AppUser, event: AgendaOccurrence) {
  const details = canSeeDetails(user, event);
  return {
    ...event,
    description: details ? event.description : event.description ? "Detalhes restritos" : null,
    address: details ? event.address : null
  };
}

export function newAgendaEvent(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  address?: string | null;
  user: AppUser;
  recurrenceRule?: string | null;
  reminderMinutesBefore?: number[];
}) {
  const now = new Date().toISOString();
  const admin = isAdmin(input.user);
  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    description: input.description?.trim() || null,
    address: input.address?.trim() || null,
    status: admin ? "approved" as AgendaStatus : "pending" as AgendaStatus,
    visibility: "shared" as AgendaVisibility,
    source: admin ? "jarvis" as AgendaSource : "manual" as AgendaSource,
    createdBy: input.user.username,
    approvedBy: admin ? input.user.username : null,
    approvedAt: admin ? now : null,
    recurrenceRule: input.recurrenceRule || null,
    reminderMinutesBefore: input.reminderMinutesBefore || [],
    createdAt: now,
    updatedAt: now
  };
}

export function groupOccurrencesByDay(occurrences: AgendaOccurrence[]) {
  return occurrences.reduce<Record<string, AgendaOccurrence[]>>((acc, occurrence) => {
    const key = dateKey(new Date(occurrence.startsAt));
    acc[key] ||= [];
    acc[key].push(occurrence);
    return acc;
  }, {});
}
