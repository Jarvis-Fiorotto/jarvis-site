import roster from "./data/roster-latest.json";
import hotels from "./data/hotels-latest.json";
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


const data = roster as RosterData;
const hotelData = hotels as HotelData;
const hotelReservations = hotelData.reservations || [];
const events = data.events.filter((event) => !event.canceled);
const collator = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

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

function airportName(code?: string | null) {
  if (!code) return "—";
  return AIRPORTS[code] || code;
}

function airportLabel(code?: string | null) {
  if (!code) return "—";
  const name = airportName(code);
  return name === code ? code : `${name} (${code})`;
}

function airportRoute(from?: string | null, to?: string | null, withCodes = true) {
  const label = withCodes ? airportLabel : airportName;
  if (!from && !to) return "—";
  if (from === to) return label(from);
  return `${label(from)} → ${label(to)}`;
}

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

function hotelsForDay(day: string) {
  return hotelReservations
    .map((reservation) => ({
      reservation,
      transports: reservation.transports.filter((transport) => transport.pickup_date_iso === day || reservation.date_iso === day && transport.direction === "to_hotel")
    }))
    .filter((item) => item.reservation.date_iso === day || item.transports.length);
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
  const allDays = Object.keys(grouped).sort();
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const firstTodayOrFuture = allDays.find((day) => day >= todayKey) || allDays[0];
  const upcomingDays = allDays.filter((day) => day >= todayKey);
  const pastDays = allDays.filter((day) => day < todayKey).reverse();
  const days = upcomingDays.length ? upcomingDays : allDays.slice(-1);
  const focusDay = firstTodayOrFuture || allDays[0];
  const focusEvents = grouped[focusDay] || [];
  const focusSummary = focusEvents.length ? daySummary(focusEvents) : null;
  const focusHotels = hotelsForDay(focusDay);
  const upcoming = getUpcoming();

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
          <a className="navItem disabled" aria-disabled="true">Agenda</a>
          <a className="navItem disabled" aria-disabled="true">Finanças</a>
          <a className="navItem disabled" aria-disabled="true">Viagens</a>
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
              Mostrando primeiro o que ainda vem pela frente. Histórico fica escondido para não poluir.
            </p>
          </div>
          <div className="statusChip">Hoje: {new Date(`${todayKey}T12:00:00-03:00`).toLocaleDateString("pt-BR")}</div>
        </header>

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
                  <span>Início</span><strong>{focusSummary.first?.start_time}</strong>
                  <span>Fim</span><strong>{focusSummary.last?.end_time}</strong>
                </div>
              </div>
            )}

            {focusHotels.length > 0 && (
              <div className="dayHotelBlock">
                {focusHotels.map(({ reservation, transports }) => (
                  <div className="dayHotelItem" key={`${reservation.airport}-${reservation.date}-${reservation.hotel?.name}`}>
                    <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
                    <span>{reservation.hotel?.address || reservation.city}</span>
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
              {focusEvents.map((event) => (
                <div className={`compactEvent ${eventKind(event)}`} key={event.id}>
                  <time>{event.start_time}</time>
                  <div>
                    <strong>{event.label}</strong>
                    <span>{kindLabel(event)} · {shortAirport(event)}</span>
                  </div>
                  <small>{kindLabel(event)}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="moduleCard nextModule">
            <p className="eyebrow">Próximo compromisso</p>
            <h2>{upcoming ? upcoming.label : "Sem eventos"}</h2>
            {upcoming && (
              <>
                <p>{longDate.format(parseDate(upcoming.date))}</p>
                <strong>{upcoming.start_time} → {upcoming.end_time}</strong>
                <span>{shortAirport(upcoming)}</span>
              </>
            )}
          </article>

          {statCards().map((stat) => (
            <article className="moduleCard miniStat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.hint}</small>
            </article>
          ))}
        </section>

        <section className="timeline compactTimeline">
          <div className="sectionTitle">
            <div>
              <p className="eyebrow">Linha do tempo</p>
              <h2>Próximos dias</h2>
            </div>
            <span className="muted">Datas passadas ficam recolhidas no fim.</span>
          </div>
          <div className="daysList compactDays">
            {days.map((day) => {
              const dayEvents = grouped[day];
              const summary = daySummary(dayEvents);
              const dayHotels = hotelsForDay(day);
              return (
                <article className={`dayCard ${day === focusDay ? "focus" : ""}`} key={day}>
                  <div className="dayHeader">
                    <div>
                      <time>{day === todayKey ? "Hoje" : collator.format(parseDate(day))}</time>
                      <strong>{summary.route}</strong>
                    </div>
                    <span>{summary.flights.length ? `${summary.flights.length} voo(s)` : kindLabel(dayEvents[0])}</span>
                  </div>
                  <div className="eventList reduced">
                    {dayEvents.slice(0, 5).map((event) => (
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
                        </div>
                      </div>
                    ))}
                    {dayEvents.length > 5 && <div className="moreEvents">+ {dayEvents.length - 5} eventos no dia</div>}
                  </div>
                  {dayHotels.length > 0 && (
                    <div className="embeddedHotels">
                      {dayHotels.map(({ reservation, transports }) => (
                        <div className="embeddedHotel" key={`${day}-${reservation.airport}-${reservation.hotel?.name}`}>
                          <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
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
                  const dayEvents = grouped[day];
                  const summary = daySummary(dayEvents);
                  const dayHotels = hotelsForDay(day);
                  return (
                    <article className="dayCard past" key={day}>
                      <div className="dayHeader">
                        <div>
                          <time>{collator.format(parseDate(day))}</time>
                          <strong>{summary.route}</strong>
                        </div>
                        <span>{summary.flights.length ? `${summary.flights.length} voo(s)` : kindLabel(dayEvents[0])}</span>
                      </div>
                      <div className="eventList reduced">
                        {dayEvents.slice(0, 5).map((event) => (
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
                            </div>
                          </div>
                        ))}
                        {dayEvents.length > 5 && <div className="moreEvents">+ {dayEvents.length - 5} eventos no dia</div>}
                      </div>
                      {dayHotels.length > 0 && (
                        <div className="embeddedHotels">
                          {dayHotels.map(({ reservation, transports }) => (
                            <div className="embeddedHotel" key={`${day}-${reservation.airport}-${reservation.hotel?.name}`}>
                              <strong>{airportLabel(reservation.airport)} · {reservation.hotel?.name || "Hotel"}</strong>
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
