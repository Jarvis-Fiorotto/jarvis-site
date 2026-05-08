import roster from "./data/roster-latest.json";
import { currentUser } from "../lib/auth";
import { redirect } from "next/navigation";

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

type RosterData = {
  source: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  counts: { events: number; duties: number; pairings: number; activities: number };
  events: RosterEvent[];
};

const data = roster as RosterData;
const events = data.events.filter((event) => !event.canceled);
const collator = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

function eventKind(event: RosterEvent) {
  if (event.type === "FLY") return "flight";
  if (event.type === "HOTEL") return "hotel";
  if (event.type === "CHECK") return event.subtype === "IN" ? "checkin" : "checkout";
  if (["OFF", "REST", "DAY_OFF"].includes(event.type)) return "off";
  return "other";
}

function kindLabel(event: RosterEvent) {
  const kind = eventKind(event);
  const labels: Record<string, string> = {
    flight: "Voo",
    hotel: "Hotel",
    checkin: "Apresentação",
    checkout: "Release",
    off: "Folga",
    other: event.type
  };
  return labels[kind];
}

function parseDate(date: string) {
  return new Date(`${date}T12:00:00-03:00`);
}

function shortAirport(event: RosterEvent) {
  if (!event.from && !event.to) return "—";
  if (event.from === event.to) return event.from;
  return `${event.from || "—"} → ${event.to || "—"}`;
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

function daySummary(dayEvents: RosterEvent[]) {
  const flights = dayEvents.filter((event) => event.type === "FLY");
  const hotels = dayEvents.filter((event) => event.type === "HOTEL");
  const first = dayEvents[0];
  const last = dayEvents[dayEvents.length - 1];
  const route = flights.length ? [flights[0].from, ...flights.map((flight) => flight.to)].filter(Boolean).join(" → ") : shortAirport(first);
  return { flights, hotels, first, last, route };
}

function getUpcoming() {
  const now = new Date();
  return events.find((event) => new Date(event.end_local) >= now) || events[0];
}

function statCards() {
  const flightEvents = events.filter((event) => event.type === "FLY");
  const hotelEvents = events.filter((event) => event.type === "HOTEL");
  const airports = new Set(flightEvents.flatMap((event) => [event.from, event.to].filter(Boolean)));
  const blockMinutes = flightEvents.reduce((sum, event) => sum + durationMinutes(event), 0);
  return [
    { label: "Voos", value: String(flightEvents.length), hint: "trechos programados" },
    { label: "Pernoites", value: String(hotelEvents.length), hint: "hotéis na escala" },
    { label: "Aeroportos", value: String(airports.size), hint: "origens/destinos" },
    { label: "Tempo em voo", value: formatDuration(blockMinutes), hint: "estimado pela escala" }
  ];
}

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const grouped = groupByDay(events);
  const days = Object.keys(grouped).sort();
  const upcoming = getUpcoming();
  const upcomingDay = grouped[upcoming?.date || days[0]] || [];
  const upcomingSummary = daySummary(upcomingDay);

  return (
    <main className="scheduleShell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Escala Azul · Danilo Fiorotto</p>
          <h1>Visão clara da escala</h1>
          <p className="muted">
            Período {new Date(data.period_start).toLocaleDateString("pt-BR")} a {new Date(data.period_end).toLocaleDateString("pt-BR")} · Atualizado em {new Date(data.generated_at).toLocaleString("pt-BR")}
          </p>
        </div>
        <form action="/api/logout" method="post">
          <span className="userPill">{user.name}</span>
          <button className="ghostButton" type="submit">Sair</button>
        </form>
      </header>

      <section className="heroDashboard">
        <article className="nextCard">
          <p className="eyebrow">Próximo compromisso</p>
          <h2>{upcoming ? `${upcoming.start_time} · ${upcoming.label}` : "Sem eventos"}</h2>
          {upcoming && (
            <>
              <p className="routeLine">{longDate.format(parseDate(upcoming.date))} · {shortAirport(upcoming)}</p>
              <div className="quickFacts">
                <span>{kindLabel(upcoming)}</span>
                {upcoming.position && <span>Posição {upcoming.position}</span>}
                {upcoming.aircraft && <span>ACFT {upcoming.aircraft}</span>}
              </div>
            </>
          )}
        </article>
        <article className="dayResume">
          <p className="eyebrow">Resumo do dia</p>
          <strong>{upcomingSummary.route}</strong>
          <span>{upcomingSummary.flights.length} voo(s) · {upcomingSummary.hotels.length ? "com hotel" : "sem hotel"}</span>
          <span>{upcomingSummary.first?.start_time} → {upcomingSummary.last?.end_time}</span>
        </article>
      </section>

      <section className="statsGrid">
        {statCards().map((stat) => (
          <article className="statCard" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{stat.hint}</small>
          </article>
        ))}
      </section>

      <section className="timeline">
        <div className="sectionTitle">
          <p className="eyebrow">Linha do tempo</p>
          <h2>Escala por dia</h2>
        </div>
        <div className="daysList">
          {days.map((day) => {
            const dayEvents = grouped[day];
            const summary = daySummary(dayEvents);
            return (
              <article className="dayCard" key={day}>
                <div className="dayHeader">
                  <div>
                    <time>{collator.format(parseDate(day))}</time>
                    <strong>{summary.route}</strong>
                  </div>
                  <span>{summary.flights.length ? `${summary.flights.length} voo(s)` : kindLabel(dayEvents[0])}</span>
                </div>
                <div className="eventList">
                  {dayEvents.map((event) => (
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
                        <div className="eventMeta">
                          {event.position && <span>{event.position}</span>}
                          {event.aircraft && <span>{event.aircraft}</span>}
                          {event.equipment && <span>E{event.equipment}</span>}
                        </div>
                        {event.type === "HOTEL" && event.details && <p className="details">{event.details}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
