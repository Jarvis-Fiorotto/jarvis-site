import { NextResponse } from "next/server";
import { currentUser, hasModule } from "../../../../lib/auth";

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/agenda", request.url));
  if (!hasModule(user, "agenda")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || "Agenda JARVIS";
  const startsAt = url.searchParams.get("startsAt") || "";
  const endsAt = url.searchParams.get("endsAt") || "";
  const description = url.searchParams.get("description") || "";
  const address = url.searchParams.get("address") || "";
  if (!startsAt || !endsAt || Number.isNaN(new Date(startsAt).getTime()) || Number.isNaN(new Date(endsAt).getTime())) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const uid = `${crypto.randomUUID()}@jarvis-site`;
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(startsAt)}`,
    `DTEND:${icsDate(endsAt)}`,
    `SUMMARY:${escapeIcs(title)}`,
    description ? `DESCRIPTION:${escapeIcs(description)}` : null,
    address ? `LOCATION:${escapeIcs(address)}` : null,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-agenda.ics"`
    }
  });
}
