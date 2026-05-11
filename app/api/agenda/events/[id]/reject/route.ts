import { NextResponse } from "next/server";
import { currentUser, isAdmin } from "../../../../../../lib/auth";
import { loadAgendaEvents, saveAgendaEvents } from "../../../../../../lib/agenda";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url), 303);
  if (!isAdmin(user)) return NextResponse.redirect(new URL("/agenda?error=forbidden", request.url), 303);
  const { id } = await context.params;
  const events = await loadAgendaEvents();
  const now = new Date().toISOString();
  const updated = events.map((event) => event.id === id ? { ...event, status: "rejected" as const, updatedAt: now } : event);
  await saveAgendaEvents(updated);
  return NextResponse.redirect(new URL("/agenda?ok=rejected", request.url), 303);
}
