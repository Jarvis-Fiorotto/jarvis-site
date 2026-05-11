type RuntimeDocument<T> = {
  payload: T;
  updated_at?: string | null;
};

export type RuntimeSource = "supabase" | "local";

export type RuntimeLoadResult<T> = {
  data: T;
  source: RuntimeSource;
  updatedAt?: string | null;
  error?: string | null;
};

const DOCUMENT_TABLE = process.env.SUPABASE_DOCUMENTS_TABLE || "jarvis_site_documents";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  return { url, anonKey };
}

export function isSupabaseRuntimeConfigured() {
  const { url, anonKey } = supabaseConfig();
  return Boolean(url && anonKey);
}

export async function loadRuntimeDocument<T>(docKey: string, fallback: T): Promise<RuntimeLoadResult<T>> {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) {
    return { data: fallback, source: "local", error: "supabase_env_missing" };
  }

  try {
    const endpoint = new URL(`/rest/v1/${DOCUMENT_TABLE}`, url);
    endpoint.searchParams.set("doc_key", `eq.${docKey}`);
    endpoint.searchParams.set("select", "payload,updated_at");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return { data: fallback, source: "local", error: `supabase_http_${response.status}` };
    }

    const rows = (await response.json()) as RuntimeDocument<T>[];
    const first = rows[0];
    if (!first?.payload) {
      return { data: fallback, source: "local", error: "supabase_document_missing" };
    }

    return { data: first.payload, source: "supabase", updatedAt: first.updated_at || null };
  } catch (error) {
    return {
      data: fallback,
      source: "local",
      error: error instanceof Error ? error.message : "supabase_fetch_failed"
    };
  }
}

export async function listRuntimeSyncRuns(limit = 20) {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) return { source: "local" as RuntimeSource, rows: [], error: "supabase_env_missing" };

  try {
    const endpoint = new URL("/rest/v1/jarvis_site_sync_runs", url);
    endpoint.searchParams.set("select", "id,source,status,started_at,finished_at,summary,error");
    endpoint.searchParams.set("order", "started_at.desc");
    endpoint.searchParams.set("limit", String(limit));
    const response = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) return { source: "local" as RuntimeSource, rows: [], error: `supabase_http_${response.status}` };
    return { source: "supabase" as RuntimeSource, rows: await response.json(), error: null };
  } catch (error) {
    return { source: "local" as RuntimeSource, rows: [], error: error instanceof Error ? error.message : "supabase_fetch_failed" };
  }
}
