import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth";
import { isSupabaseRuntimeConfigured, listRuntimeSyncRuns } from "../../lib/runtime-data";

export const dynamic = "force-dynamic";

type SyncRun = {
  id: string;
  source: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  summary?: Record<string, unknown> | null;
  error?: string | null;
};

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const configured = isSupabaseRuntimeConfigured();
  const syncRuns = await listRuntimeSyncRuns(30);
  const rows = syncRuns.rows as SyncRun[];

  return (
    <main className="appShell adminShell">
      <section className="contentShell fullWidth">
        <header className="dashboardHeader">
          <div>
            <p className="eyebrow">JARVIS · Administração</p>
            <h1>Sincronização da escala</h1>
            <p className="muted">Painel operacional para confirmar se os dados vivos estão chegando sem deploy do site.</p>
          </div>
          <div className="statusStack">
            <div className="statusChip">Runtime: {configured ? "Supabase configurado" : "cache local"}</div>
            <div className="statusChip">Runs: {rows.length}</div>
          </div>
        </header>

        <section className="panelCard">
          <div className="sectionTitle">
            <div>
              <p className="eyebrow">Últimas execuções</p>
              <h2>CAE / CrewCare / Flight cache</h2>
            </div>
          </div>
          {!configured && (
            <p className="muted">Supabase ainda não está configurado no ambiente. O site permanece funcional usando cache local versionado.</p>
          )}
          {syncRuns.error && <p className="muted">Fonte indisponível: {syncRuns.error}</p>}
          <div className="timelineList">
            {rows.map((run) => (
              <article className="eventCard" key={run.id}>
                <div className="eventTopline">
                  <span>{run.source}</span>
                  <strong>{run.status}</strong>
                </div>
                <h3>{formatDate(run.started_at)} → {formatDate(run.finished_at)}</h3>
                {run.summary && <p>{JSON.stringify(run.summary)}</p>}
                {run.error && <p className="muted">Erro: {run.error}</p>}
              </article>
            ))}
            {!rows.length && <p className="muted">Nenhuma execução registrada ainda.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
