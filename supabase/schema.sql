-- JARVIS site runtime data store
-- Apply in Supabase SQL Editor or via psql with the project database URL.

create table if not exists public.jarvis_site_documents (
  doc_key text primary key,
  payload jsonb not null,
  source text not null default 'jarvis-sync',
  checksum text,
  updated_at timestamptz not null default now()
);

create table if not exists public.jarvis_site_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null check (status in ('running', 'ok', 'blocked', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);

alter table public.jarvis_site_documents enable row level security;
alter table public.jarvis_site_sync_runs enable row level security;

-- Private dashboard reads with anon key; writes remain service-role only.
-- The site already requires its own login before rendering these reads.
drop policy if exists "jarvis_site_documents_read" on public.jarvis_site_documents;
create policy "jarvis_site_documents_read"
  on public.jarvis_site_documents
  for select
  to anon, authenticated
  using (true);

drop policy if exists "jarvis_site_sync_runs_read" on public.jarvis_site_sync_runs;
create policy "jarvis_site_sync_runs_read"
  on public.jarvis_site_sync_runs
  for select
  to anon, authenticated
  using (true);

create or replace function public.set_jarvis_site_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jarvis_site_documents_updated_at on public.jarvis_site_documents;
create trigger trg_jarvis_site_documents_updated_at
before update on public.jarvis_site_documents
for each row execute function public.set_jarvis_site_documents_updated_at();

grant select on public.jarvis_site_documents to anon, authenticated;
grant select on public.jarvis_site_sync_runs to anon, authenticated;
grant all on public.jarvis_site_documents to service_role;
grant all on public.jarvis_site_sync_runs to service_role;
