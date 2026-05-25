import { NextResponse } from "next/server";
import { currentUser, isAdmin } from "../../../../../../lib/auth";
import {
  expandAgendaEvents,
  intervalConflicts,
  loadAgendaEvents,
  localDateTimeToIso,
  makeRecurrenceRule,
  rosterAgendaBlocks,
  saveAgendaEvents
} from "../../../../../../lib/agenda";

function redirectAgenda(request: Request, params: Record<string, string>) {
  const url = new URL("/agenda", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, 303);
}

function safeReturnTo(request: Request, raw: FormDataEntryValue | null) {
  const fallback = new URL("/agenda", request.url);
  if (!raw) return fallback;
  const value = String(raw);
  if (!value.startsWith("/agenda")) return fallback;
  return new URL(value, request.url);
}

function reminderMinutesFromForm(formData: FormData) {
  return formData.getAll("reminderMinutesBefore")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 10080)
    .sort((a, b) => b - a);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url), 303);
  if (!isAdmin(user)) return redirectAgenda(request, { error: "forbidden" });

  const { id } = await context.params;
  const formData = await request.formData();
  const returnTo = safeReturnTo(request, formData.get("returnTo"));
  const title = String(formData.get("title") || "").trim();
  const startsAt = localDateTimeToIso(String(formData.get("startsAt") || ""));
  const endsAt = localDateTimeToIso(String(formData.get("endsAt") || ""));
  const description = String(formData.get("description") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const recurrenceRule = makeRecurrenceRule(
    String(formData.get("recurrenceFrequency") || "none"),
    String(formData.get("recurrenceInterval") || "1"),
    String(formData.get("recurrenceUntil") || "")
  );

  if (!title || !startsAt || !endsAt) return redirectAgenda(request, { error: "missing_fields" });
  if (new Date(endsAt) <= new Date(startsAt)) return redirectAgenda(request, { error: "invalid_time" });

  const events = await loadAgendaEvents();
  const target = events.find((event) => event.id === id);
  if (!target || target.source === "roster") return redirectAgenda(request, { error: "missing_event" });

  const now = new Date().toISOString();
  const updatedEvent = {
    ...target,
    title,
    startsAt,
    endsAt,
    description: description || null,
    address: address || null,
    recurrenceRule,
    reminderMinutesBefore: reminderMinutesFromForm(formData),
    updatedAt: now
  };

  const rangeStart = new Date(new Date(startsAt).getTime() - 1000 * 60 * 60 * 24 * 370);
  const rangeEnd = new Date(new Date(endsAt).getTime() + 1000 * 60 * 60 * 24 * 370);
  const rosterBlocks = await rosterAgendaBlocks(rangeStart, rangeEnd);
  const busy = expandAgendaEvents([...events.filter((event) => event.id !== id), ...rosterBlocks], rangeStart, rangeEnd);
  const candidateOccurrences = expandAgendaEvents([updatedEvent], rangeStart, rangeEnd);
  const conflict = candidateOccurrences.flatMap((candidate) => intervalConflicts(candidate.startsAt, candidate.endsAt, busy, id))[0];
  if (conflict) return redirectAgenda(request, { error: "busy", conflict: conflict.title });

  await saveAgendaEvents(events.map((event) => event.id === id ? updatedEvent : event));
  returnTo.searchParams.set("ok", "updated");
  return NextResponse.redirect(returnTo, 303);
}
