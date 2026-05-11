import { NextResponse } from "next/server";
import { currentUser, isAdmin } from "../../../../../../lib/auth";
import { expandAgendaEvents, intervalConflicts, loadAgendaEvents, rosterAgendaBlocks, saveAgendaEvents } from "../../../../../../lib/agenda";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url), 303);
  if (!isAdmin(user)) return NextResponse.redirect(new URL("/agenda?error=forbidden", request.url), 303);
  const { id } = await context.params;
  const events = await loadAgendaEvents();
  const target = events.find((event) => event.id === id);
  if (!target) return NextResponse.redirect(new URL("/agenda?error=missing_event", request.url), 303);
  const rangeStart = new Date(new Date(target.startsAt).getTime() - 1000 * 60 * 60 * 24 * 370);
  const rangeEnd = new Date(new Date(target.endsAt).getTime() + 1000 * 60 * 60 * 24 * 370);
  const rosterBlocks = await rosterAgendaBlocks(rangeStart, rangeEnd);
  const busy = expandAgendaEvents([...events.filter((event) => event.id !== id), ...rosterBlocks], rangeStart, rangeEnd);
  const candidateOccurrences = expandAgendaEvents([{ ...target, status: "approved" }], rangeStart, rangeEnd);
  const conflict = candidateOccurrences.flatMap((candidate) => intervalConflicts(candidate.startsAt, candidate.endsAt, busy))[0];
  if (conflict) return NextResponse.redirect(new URL(`/agenda?error=busy&conflict=${encodeURIComponent(conflict.title)}`, request.url), 303);
  const now = new Date().toISOString();
  const updated = events.map((event) => event.id === id ? { ...event, status: "approved" as const, approvedBy: user.username, approvedAt: now, updatedAt: now } : event);
  await saveAgendaEvents(updated);
  return NextResponse.redirect(new URL("/agenda?ok=approved", request.url), 303);
}
