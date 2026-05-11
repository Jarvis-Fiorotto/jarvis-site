import { NextResponse } from "next/server";
import { currentUser, isAdmin } from "../../../../../../lib/auth";
import { loadAgendaEvents, saveAgendaEvents } from "../../../../../../lib/agenda";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url), 303);
  if (!isAdmin(user)) return NextResponse.redirect(new URL("/agenda?error=forbidden", request.url), 303);
  const formData = await request.formData();
  const minutes = formData.getAll("reminderMinutesBefore")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 10080)
    .sort((a, b) => b - a);
  const { id } = await context.params;
  const now = new Date().toISOString();
  const events = await loadAgendaEvents();
  const updated = events.map((event) => event.id === id ? { ...event, reminderMinutesBefore: minutes, updatedAt: now } : event);
  await saveAgendaEvents(updated);
  return NextResponse.redirect(new URL("/agenda?ok=reminder", request.url), 303);
}
