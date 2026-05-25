import type { CSSProperties } from "react";
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

type CalendarView = "week" | "month";

const WEEKDAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HOURS = Array.from({ length: 18 }, (_, index) => index + 5);

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfMonth(date: Date) {
  return startOfSaoPauloDay(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`);
}

function endOfMonth(date: Date) {
  return endOfSaoPauloDay(dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)));
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfSaoPauloDay(dateKey(addDays(date, mondayOffset)));
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(startOfSaoPauloDay(value).getTime());
}

function statusLabel(status: string) {
  if (status === "approved") return "Aprovado";
  if (status === "pending") return "Pendente";
  if (status === "rejected") return "Rejeitado";
  return status;
}

function sourceLabel(event: AgendaOccurrence) {
  if (event.source === "roster") return "Escala";
  if (event.status === "pending") return "Pendente";
  if (event.source === "jarvis") return "JARVIS";
  return "Pessoal";
}

function eventTone(event: AgendaOccurrence) {
  if (event.status === "pending") return "pending";
  if (event.source === "roster") return "roster";
  if (event.visibility === "private") return "private";
  return "manual";
}

function messageFor(searchParams: Record<string, string | string[] | undefined>) {
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : "";
  const error = typeof searchParams.error === "string" ? searchParams.error : "";
  const conflict = typeof searchParams.conflict === "string" ? searchParams.conflict : "";
  if (ok === "created") return "Evento criado e aprovado.";
  if (ok === "pending") return "Solicitação enviada. Danilo/JARVIS precisa aprovar.";
  if (ok === "approved") return "Evento aprovado.";
  if (ok === "rejected") return "Evento rejeitado.";
  if (ok === "updated") return "Evento atualizado.";
  if (ok === "reminder") return "Lembretes atualizados.";
  if (error === "busy") return `Horário indisponível${conflict ? `: conflito com ${conflict}` : ""}.`;
  if (error === "forbidden") return "Ação restrita ao Danilo/JARVIS.";
  if (error === "invalid_time") return "Horário inválido.";
  if (error === "missing_fields") return "Preencha nome, início e fim.";
  return null;
}

function hrefFor(view: CalendarView, date: Date | string) {
  const key = typeof date === "string" ? date : dateKey(date);
  return `/agenda?view=${view}&date=${key}`;
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" }).format(date);
}

function formatDayNumber(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit" }).format(date);
}

function minutesInSaoPaulo(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function recurrenceDefaults(rule?: string | null) {
  if (!rule) return { frequency: "none", interval: "1", until: "" };
  const parts = Object.fromEntries(rule.split(";").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const until = parts.UNTIL?.replace(/(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3") || "";
  return {
    frequency: parts.FREQ || "none",
    interval: parts.INTERVAL || "1",
    until
  };
}

function modalIdFor(event: AgendaOccurrence) {
  return `edit-${event.occurrenceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function EventEditModal({ event, returnTo }: { event: AgendaOccurrence; returnTo: string }) {
  const recurrence = recurrenceDefaults(event.recurrenceRule);
  const reminders = new Set(event.reminderMinutesBefore || []);
  const modalId = modalIdFor(event);

  return (
    <section className="editModal" id={modalId} role="dialog" aria-modal="true" aria-labelledby={`${modalId}-title`}>
      <a className="editModalBackdrop" href="#" aria-label="Fechar modal" />
      <div className="editModalCard panelCard">
        <div className="editModalHeader">
          <div>
            <p className="eyebrow">Editar compromisso</p>
            <h2 id={`${modalId}-title`}>{event.title}</h2>
          </div>
          <a className="ghostButton" href="#">Fechar</a>
        </div>
        {event.isOccurrence && <p className="muted">Este evento é recorrente. A edição altera a série inteira.</p>}
        <form action={`/api/agenda/events/${event.baseEventId}/edit`} method="post" className="agendaForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>Nome<input name="title" required maxLength={120} defaultValue={event.title} /></label>
          <div className="formGrid twoColumns">
            <label>Início<input name="startsAt" required type="datetime-local" defaultValue={toLocalInputValue(event.originalStartsAt)} /></label>
            <label>Fim<input name="endsAt" required type="datetime-local" defaultValue={toLocalInputValue(event.originalEndsAt)} /></label>
          </div>
          <label>Descrição<textarea name="description" rows={3} defaultValue={event.description || ""} /></label>
          <label>Endereço<input name="address" defaultValue={event.address || ""} /></label>
          <div className="formGrid">
            <label>Recorrência
              <select name="recurrenceFrequency" defaultValue={recurrence.frequency}>
                <option value="none">Não repetir</option>
                <option value="DAILY">Diária</option>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensal</option>
              </select>
            </label>
            <label>Intervalo<input name="recurrenceInterval" type="number" min="1" max="52" defaultValue={recurrence.interval} /></label>
            <label>Repetir até<input name="recurrenceUntil" type="date" defaultValue={recurrence.until} /></label>
          </div>
          <fieldset className="reminderChoices">
            <legend>Lembretes Discord</legend>
            <label><input type="checkbox" name="reminderMinutesBefore" value="1440" defaultChecked={reminders.has(1440)} /> 1 dia antes</label>
            <label><input type="checkbox" name="reminderMinutesBefore" value="60" defaultChecked={reminders.has(60)} /> 1 hora antes</label>
            <label><input type="checkbox" name="reminderMinutesBefore" value="15" defaultChecked={reminders.has(15)} /> 15 min antes</label>
          </fieldset>
          <button className="primaryButton" type="submit">Salvar alterações</button>
        </form>
      </div>
    </section>
  );
}

function EventActions({ event, user, admin, returnTo }: { event: AgendaOccurrence; user: AppUser; admin: boolean; returnTo: string }) {
  const detailsAllowed = canSeeDetails(user, event);
  const mapUrl = event.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}` : null;
  const icsUrl = `/api/agenda/ics?title=${encodeURIComponent(event.title)}&startsAt=${encodeURIComponent(event.startsAt)}&endsAt=${encodeURIComponent(event.endsAt)}&description=${encodeURIComponent(detailsAllowed ? event.description || "" : "")}&address=${encodeURIComponent(detailsAllowed ? event.address || "" : "")}`;

  return (
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
      {admin && !event.readonly && detailsAllowed && <a className="ghostButton" href={`#${modalIdFor(event)}`}>Editar</a>}
      {detailsAllowed && mapUrl && <a className="ghostButton" href={mapUrl} target="_blank" rel="noreferrer">Mapa</a>}
      <a className="ghostButton" href={icsUrl}>Exportar .ics</a>
      {admin && !event.readonly && detailsAllowed && <EventEditModal event={event} returnTo={returnTo} />}
    </div>
  );
}

function EventDetailCard({ event, user, admin, returnTo }: { event: AgendaOccurrence; user: AppUser; admin: boolean; returnTo: string }) {
  const detailsAllowed = canSeeDetails(user, event);
  return (
    <article className={`calendarDetailCard ${eventTone(event)}`}>
      <div className="eventTopline">
        <span>{formatAgendaTime(event.startsAt)} → {formatAgendaTime(event.endsAt)}</span>
        <strong>{sourceLabel(event)}</strong>
      </div>
      <h3>{event.title}</h3>
      {detailsAllowed && event.description && <p>{event.description}</p>}
      {!detailsAllowed && <p className="muted">Detalhes internos restritos.</p>}
      {detailsAllowed && event.address && <p className="muted">{event.address}</p>}
      {event.recurrenceRule && <p className="muted">Recorrente · {event.recurrenceRule}</p>}
      <EventActions event={event} user={user} admin={admin} returnTo={returnTo} />
    </article>
  );
}

function compactTitle(title: string) {
  return title.length > 34 ? `${title.slice(0, 31)}…` : title;
}

function WeekCalendar({ days, groups, today, user, admin, returnTo }: { days: Date[]; groups: Record<string, AgendaOccurrence[]>; today: string; user: AppUser; admin: boolean; returnTo: string }) {
  return (
    <section className="calendarBoard weekBoard">
      <div className="weekHeaderSpacer" />
      {days.map((day, index) => {
        const key = dateKey(day);
        return (
          <Link className={`weekDayHeader ${key === today ? "today" : ""}`} href={hrefFor("week", key)} key={key}>
            <span>{WEEKDAY_SHORT[index]}</span>
            <strong>{formatDayNumber(day)}</strong>
          </Link>
        );
      })}
      <div className="hourRail">
        {HOURS.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}
      </div>
      {days.map((day) => {
        const key = dateKey(day);
        const events = groups[key] || [];
        return (
          <div className={`dayColumn ${key === today ? "today" : ""}`} key={key}>
            {HOURS.map((hour) => <div className="hourLine" key={hour} />)}
            {events.map((event) => {
              const minutesStart = Math.max(5 * 60, minutesInSaoPaulo(event.startsAt));
              const minutesEnd = Math.min(23 * 60, minutesInSaoPaulo(event.endsAt));
              const top = ((minutesStart - 5 * 60) / (18 * 60)) * 100;
              const height = Math.max(7, ((Math.max(minutesEnd, minutesStart + 30) - minutesStart) / (18 * 60)) * 100);
              const style = { "--event-top": `${top}%`, "--event-height": `${height}%` } as CSSProperties;
              return (
                <article className={`weekEvent ${eventTone(event)}`} style={style} key={event.occurrenceId} title={event.title}>
                  <span>{formatAgendaTime(event.startsAt)}</span>
                  <strong>{compactTitle(event.title)}</strong>
                </article>
              );
            })}
          </div>
        );
      })}
      <div className="weekDetails">
        {days.map((day) => {
          const key = dateKey(day);
          const events = groups[key] || [];
          return (
            <section className="dayAgendaStack" key={key}>
              <div className="dayAgendaTitle"><span>{formatAgendaDate(day.toISOString())}</span><strong>{events.length}</strong></div>
              {events.map((event) => <EventDetailCard event={event} user={user} admin={admin} returnTo={returnTo} key={event.occurrenceId} />)}
              {!events.length && <p className="muted">Livre.</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function MonthCalendar({ selectedDate, occurrences, groups, today }: { selectedDate: Date; occurrences: AgendaOccurrence[]; groups: Record<string, AgendaOccurrence[]>; today: string }) {
  const monthStart = startOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const selectedMonth = dateKey(monthStart).slice(0, 7);

  return (
    <section className="calendarBoard monthBoard">
      {WEEKDAY_SHORT.map((day) => <div className="monthWeekday" key={day}>{day}</div>)}
      {days.map((day) => {
        const key = dateKey(day);
        const dayEvents = groups[key] || [];
        const outOfMonth = !key.startsWith(selectedMonth);
        return (
          <Link className={`monthCell ${outOfMonth ? "out" : ""} ${key === today ? "today" : ""}`} href={hrefFor("week", key)} key={key}>
            <div className="monthCellTop">
              <strong>{formatDayNumber(day)}</strong>
              {key === today && <span>Hoje</span>}
            </div>
            <div className="monthEvents">
              {dayEvents.slice(0, 4).map((event) => (
                <span className={`monthEventPill ${eventTone(event)}`} key={event.occurrenceId}>{formatAgendaTime(event.startsAt)} · {compactTitle(event.title)}</span>
              ))}
              {dayEvents.length > 4 && <em>+ {dayEvents.length - 4} itens</em>}
            </div>
          </Link>
        );
      })}
      {!occurrences.length && <p className="muted">Nenhum compromisso neste mês.</p>}
    </section>
  );
}

function AgendaForm({ admin }: { admin: boolean }) {
  return (
    <details className="panelCard createEventPanel">
      <summary>
        <div>
          <p className="eyebrow">Novo compromisso</p>
          <h2>{admin ? "Adicionar evento" : "Sugerir evento"}</h2>
        </div>
        <span className="ghostButton">Abrir formulário</span>
      </summary>
      <form action="/api/agenda/events" method="post" className="agendaForm">
        <label>Nome<input name="title" required maxLength={120} placeholder="Ex: Consulta, jantar, reunião" /></label>
        <div className="formGrid twoColumns">
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
    </details>
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
  const selectedKey = typeof params.date === "string" && isValidDateKey(params.date) ? params.date : today;
  const view: CalendarView = params.view === "month" ? "month" : "week";
  const selectedDate = startOfSaoPauloDay(selectedKey);
  const weekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const rangeStart = view === "month" ? startOfWeek(monthStart) : weekStart;
  const rangeEnd = view === "month" ? endOfSaoPauloDay(dateKey(addDays(startOfWeek(monthEnd), 6))) : endOfSaoPauloDay(dateKey(addDays(weekStart, 6)));

  const manualEvents = await loadAgendaEvents();
  const rosterBlocks = await rosterAgendaBlocks(rangeStart, rangeEnd);
  const occurrences = expandAgendaEvents([...manualEvents, ...rosterBlocks], rangeStart, rangeEnd)
    .filter((event) => admin || event.status === "approved")
    .map((event) => publicEventFor(user, event));
  const groups = groupOccurrencesByDay(occurrences);
  const pending = occurrences.filter((event) => event.status === "pending");
  const previousDate = view === "month" ? addMonths(selectedDate, -1) : addDays(selectedDate, -7);
  const nextDate = view === "month" ? addMonths(selectedDate, 1) : addDays(selectedDate, 7);
  const returnTo = `/agenda?view=${view}&date=${selectedKey}`;

  return (
    <main className="agendaShell calendarShell">
      <header className="calendarTopbar">
        <div>
          <p className="eyebrow">JARVIS · Agenda pessoal</p>
          <h1>Agenda</h1>
          <p className="muted">Calendário visual com compromissos, escala, bloqueios, aprovações e lembretes.</p>
        </div>
        <div className="statusStack">
          <Link className="statusChip" href="/">Escala</Link>
          <div className="statusChip">{user.name}</div>
        </div>
      </header>

      {message && <section className="panelCard"><p>{message}</p></section>}

      <section className="calendarToolbar panelCard">
        <div className="calendarPeriod">
          <p className="eyebrow">{view === "month" ? "Mês" : "Semana"}</p>
          <h2>{view === "month" ? formatMonthTitle(selectedDate) : `${formatAgendaDate(weekDays[0].toISOString())} — ${formatAgendaDate(weekDays[6].toISOString())}`}</h2>
        </div>
        <nav className="calendarNav" aria-label="Navegação da agenda">
          <Link className="ghostButton" href={hrefFor(view, previousDate)}>← Anterior</Link>
          <Link className="ghostButton" href={hrefFor(view, today)}>Hoje</Link>
          <Link className="ghostButton" href={hrefFor(view, nextDate)}>Próxima →</Link>
        </nav>
        <div className="viewSwitch" aria-label="Alternar visualização">
          <Link className={view === "week" ? "active" : ""} href={hrefFor("week", selectedDate)}>Semana</Link>
          <Link className={view === "month" ? "active" : ""} href={hrefFor("month", selectedDate)}>Mês</Link>
        </div>
      </section>

      <AgendaForm admin={admin} />

      {admin && pending.length > 0 && (
        <section className="panelCard pendingStrip">
          <div>
            <p className="eyebrow">Aprovação</p>
            <h2>{pending.length} evento(s) pendente(s)</h2>
          </div>
          <div className="pendingList">
            {pending.map((event) => <EventDetailCard event={event} user={user} admin={admin} returnTo={returnTo} key={event.occurrenceId} />)}
          </div>
        </section>
      )}

      {view === "month" ? (
        <MonthCalendar selectedDate={selectedDate} occurrences={occurrences} groups={groups} today={today} />
      ) : (
        <WeekCalendar days={weekDays} groups={groups} today={today} user={user} admin={admin} returnTo={returnTo} />
      )}
    </main>
  );
}
