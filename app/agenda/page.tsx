import Link from "next/link";
import { redirect } from "next/navigation";
import { AppUser, currentUser, hasModule, isAdmin } from "../../lib/auth";
import {
  AgendaOccurrence,
  canSeeDetails,
  dateKey,
  endOfSaoPauloDay,
  expandAgendaEvents,
  formatAgendaDate,
  formatAgendaTime,
  groupOccurrencesByDay,
  loadAgendaEvents,
  publicEventFor,
  rosterAgendaBlocks,
  startOfSaoPauloDay,
  todayKey,
  toLocalInputValue
} from "../../lib/agenda";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function statusLabel(status: string) {
  if (status === "approved") return "Aprovado";
  if (status === "pending") return "Pendente";
  if (status === "rejected") return "Rejeitado";
  return status;
}

function messageFor(searchParams: Record<string, string | string[] | undefined>) {
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : "";
  const error = typeof searchParams.error === "string" ? searchParams.error : "";
  const conflict = typeof searchParams.conflict === "string" ? searchParams.conflict : "";
  if (ok === "created") return "Evento criado e aprovado.";
  if (ok === "pending") return "Solicitação enviada. Danilo/JARVIS precisa aprovar.";
  if (ok === "approved") return "Evento aprovado.";
  if (ok === "rejected") return "Evento rejeitado.";
  if (ok === "reminder") return "Lembretes atualizados.";
  if (error === "busy") return `Horário indisponível${conflict ? `: conflito com ${conflict}` : ""}.`;
  if (error === "forbidden") return "Ação restrita ao Danilo/JARVIS.";
  if (error === "invalid_time") return "Horário inválido.";
  if (error === "missing_fields") return "Preencha nome, início e fim.";
  return null;
}

function EventCard({ event, user, admin }: { event: AgendaOccurrence; user: AppUser; admin: boolean }) {
  const detailsAllowed = canSeeDetails(user, event);
  const mapUrl = event.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}` : null;
  const icsUrl = `/api/agenda/ics?title=${encodeURIComponent(event.title)}&startsAt=${encodeURIComponent(event.startsAt)}&endsAt=${encodeURIComponent(event.endsAt)}&description=${encodeURIComponent(detailsAllowed ? event.description || "" : "")}&address=${encodeURIComponent(detailsAllowed ? event.address || "" : "")}`;

  return (
    <article className={`eventCard agendaEvent ${event.status === "pending" ? "pending" : ""}`}>
      <div className="eventTopline">
        <span>{formatAgendaTime(event.startsAt)} → {formatAgendaTime(event.endsAt)}</span>
        <strong>{statusLabel(event.status)}</strong>
      </div>
      <h3>{event.title}</h3>
      {event.description && <p>{event.description}</p>}
      {!detailsAllowed && <p className="muted">Detalhes internos restritos.</p>}
      {detailsAllowed && event.address && <p className="muted">{event.address}</p>}
      {event.recurrenceRule && <p className="muted">Recorrente · {event.recurrenceRule}</p>}
      <div className="actionRow">
        {admin && !event.readonly && event.status === "pending" && (
          <>
            <form action={`/api/agenda/events/${event.baseEventId}/approve`} method="post"><button className="ghostButton" type="submit">Aprovar</button></form>
            <form action={`/api/agenda/events/${event.baseEventId}/reject`} method="post"><button className="ghostButton" type="submit">Rejeitar</button></form>
          </>
        )}
        {admin && !event.readonly && event.status === "approved" && (
          <form action={`/api/agenda/events/${event.baseEventId}/remind`} method="post" className="inlineForm">
            <input type="hidden" name="reminderMinutesBefore" value="60" />
            <input type="hidden" name="reminderMinutesBefore" value="15" />
            <button className="ghostButton" type="submit">Me lembrar</button>
          </form>
        )}
        {detailsAllowed && mapUrl && <a className="ghostButton" href={mapUrl} target="_blank" rel="noreferrer">Abrir no mapa</a>}
        <a className="ghostButton" href={icsUrl}>Enviar para calendário</a>
      </div>
    </article>
  );
}

function EventsList({ title, events, user, admin }: { title: string; events: AgendaOccurrence[]; user: AppUser; admin: boolean }) {
  return (
    <section className="panelCard">
      <div className="sectionTitle">
        <div>
          <p className="eyebrow">Agenda</p>
          <h2>{title}</h2>
        </div>
        <span className="muted">{events.length} item(ns)</span>
      </div>
      <div className="timelineList">
        {events.map((event) => <EventCard event={event} user={user} admin={admin} key={event.occurrenceId} />)}
        {!events.length && <p className="muted">Nenhum compromisso neste período.</p>}
      </div>
    </section>
  );
}

export default async function AgendaPage({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/agenda");
  if (!hasModule(user, "agenda")) redirect("/");
  const admin = isAdmin(user);
  const params = searchParams ? await searchParams : {};
  const message = messageFor(params);

  const today = todayKey();
  const start = startOfSaoPauloDay(today);
  const monthEnd = endOfSaoPauloDay(dateKey(addDays(start, 31)));
  const sevenEnd = endOfSaoPauloDay(dateKey(addDays(start, 7)));
  const manualEvents = await loadAgendaEvents();
  const rosterBlocks = await rosterAgendaBlocks(start, monthEnd);
  const occurrences = expandAgendaEvents([...manualEvents, ...rosterBlocks], start, monthEnd)
    .filter((event) => admin || event.status === "approved")
    .map((event) => publicEventFor(user, event));
  const todayEvents = occurrences.filter((event) => dateKey(new Date(event.startsAt)) === today);
  const nextSevenEvents = occurrences.filter((event) => new Date(event.startsAt) > endOfSaoPauloDay(today) && new Date(event.startsAt) <= sevenEnd);
  const monthGroups = groupOccurrencesByDay(occurrences);
  const monthDays = Object.keys(monthGroups).sort();
  const pending = occurrences.filter((event) => event.status === "pending");

  return (
    <main className="appShell adminShell">
      <section className="contentShell fullWidth">
        <header className="dashboardHeader">
          <div>
            <p className="eyebrow">JARVIS · Agenda pessoal</p>
            <h1>Agenda</h1>
            <p className="muted">Compromissos pessoais, bloqueios da escala, recorrências, aprovações e lembretes via JARVIS.</p>
          </div>
          <div className="statusStack">
            <Link className="statusChip" href="/">Escala</Link>
            <div className="statusChip">Logado como {user.name}</div>
          </div>
        </header>

        {message && <section className="panelCard"><p>{message}</p></section>}

        <section className="panelCard">
          <div className="sectionTitle">
            <div>
              <p className="eyebrow">Novo compromisso</p>
              <h2>{admin ? "Adicionar evento" : "Sugerir evento"}</h2>
            </div>
            <span className="muted">Horários ocupados pela escala/agenda são bloqueados.</span>
          </div>
          <form action="/api/agenda/events" method="post" className="agendaForm">
            <label>Nome<input name="title" required maxLength={120} placeholder="Ex: Consulta, jantar, reunião" /></label>
            <div className="formGrid">
              <label>Início<input name="startsAt" required type="datetime-local" defaultValue={toLocalInputValue(new Date().toISOString())} /></label>
              <label>Fim<input name="endsAt" required type="datetime-local" defaultValue={toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString())} /></label>
            </div>
            <label>Descrição<textarea name="description" rows={3} placeholder="Detalhes internos. Bruna/René veem nome e horário, não estes detalhes." /></label>
            <label>Endereço<input name="address" placeholder="Rua, número, cidade" /></label>
            <div className="formGrid">
              <label>Recorrência
                <select name="recurrenceFrequency" defaultValue="none">
                  <option value="none">Não repetir</option>
                  <option value="DAILY">Diária</option>
                  <option value="WEEKLY">Semanal</option>
                  <option value="MONTHLY">Mensal</option>
                </select>
              </label>
              <label>Intervalo<input name="recurrenceInterval" type="number" min="1" max="52" defaultValue="1" /></label>
              <label>Repetir até<input name="recurrenceUntil" type="date" /></label>
            </div>
            {admin && (
              <fieldset className="reminderChoices">
                <legend>Lembretes Discord</legend>
                <label><input type="checkbox" name="reminderMinutesBefore" value="1440" /> 1 dia antes</label>
                <label><input type="checkbox" name="reminderMinutesBefore" value="60" /> 1 hora antes</label>
                <label><input type="checkbox" name="reminderMinutesBefore" value="15" /> 15 min antes</label>
              </fieldset>
            )}
            <button className="primaryButton" type="submit">{admin ? "Adicionar evento" : "Enviar para aprovação"}</button>
          </form>
        </section>

        {admin && pending.length > 0 && <EventsList title="Pendentes de aprovação" events={pending} user={user} admin={admin} />}
        <EventsList title="Hoje" events={todayEvents} user={user} admin={admin} />
        <EventsList title="Próximos 7 dias" events={nextSevenEvents} user={user} admin={admin} />

        <section className="panelCard">
          <div className="sectionTitle">
            <div>
              <p className="eyebrow">Mês</p>
              <h2>Visão mensal</h2>
            </div>
            <span className="muted">Próximos 31 dias</span>
          </div>
          <div className="daysList compactDays">
            {monthDays.map((day) => (
              <article className="dayCard" key={day}>
                <div className="dayHeader">
                  <div>
                    <time>{day === today ? "Hoje" : formatAgendaDate(startOfSaoPauloDay(day).toISOString())}</time>
                    <strong>{monthGroups[day].length} compromisso(s)</strong>
                  </div>
                </div>
                <div className="eventList reduced">
                  {monthGroups[day].slice(0, 5).map((event) => (
                    <div className="eventRow" key={event.occurrenceId}>
                      <div className="timeBlock"><strong>{formatAgendaTime(event.startsAt)}</strong><span>{formatAgendaTime(event.endsAt)}</span></div>
                      <div className="eventMain"><div><strong>{event.title}</strong><span>{statusLabel(event.status)}</span></div></div>
                    </div>
                  ))}
                  {monthGroups[day].length > 5 && <div className="moreEvents">+ {monthGroups[day].length - 5} itens</div>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
