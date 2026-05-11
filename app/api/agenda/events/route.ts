import { NextResponse } from "next/server";
import { currentUser, hasModule, isAdmin } from "../../../../lib/auth";
import {
  expandAgendaEvents,
  intervalConflicts,
  loadAgendaEvents,
  localDateTimeToIso,
  makeRecurrenceRule,
  newAgendaEvent,
  rosterAgendaBlocks,
  saveAgendaEvents
} from "../../../../lib/agenda";

function redirectAgenda(request: Request, params: Record<string, string>) {
  const url = new URL("/agenda", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, 303);
}

function reminderMinutesFromForm(formData: FormData) {
  return formData.getAll("reminderMinutesBefore")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 10080)
    .sort((a, b) => b - a);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url), 303);
  if (!hasModule(user, "agenda")) return redirectAgenda(request, { error: "forbidden" });

  const formData = await request.formData();
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

  const existing = await loadAgendaEvents();
  const rangeStart = new Date(new Date(startsAt).getTime() - 1000 * 60 * 60 * 24 * 370);
  const rangeEnd = new Date(new Date(endsAt).getTime() + 1000 * 60 * 60 * 24 * 370);
  const rosterBlocks = await rosterAgendaBlocks(rangeStart, rangeEnd);
  const busy = expandAgendaEvents([...existing, ...rosterBlocks], rangeStart, rangeEnd);

  const event = newAgendaEvent({
    title,
    startsAt,
    endsAt,
    description,
    address,
    user,
    recurrenceRule,
    reminderMinutesBefore: isAdmin(user) ? reminderMinutesFromForm(formData) : []
  });

  const candidateOccurrences = expandAgendaEvents([event], rangeStart, rangeEnd);
  const conflict = candidateOccurrences.flatMap((candidate) => intervalConflicts(candidate.startsAt, candidate.endsAt, busy))[0];
  if (conflict) return redirectAgenda(request, { error: "busy", conflict: conflict.title });

  await saveAgendaEvents([event, ...existing]);
  return redirectAgenda(request, { ok: event.status === "approved" ? "created" : "pending" });
}
