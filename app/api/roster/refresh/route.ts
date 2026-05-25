import { NextResponse } from "next/server";
import { currentUser, hasModule, isAdmin } from "../../../../lib/auth";

const SYNC_TABLE = process.env.SUPABASE_SYNC_RUNS_TABLE || "jarvis_site_sync_runs";

function supabaseAdminConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, serviceRoleKey };
}

function redirectHome(request: Request, params: Record<string, string>) {
  const url = new URL("/", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, 303);
}

async function queueManualRefresh(user: { username: string }) {
  const { url, serviceRoleKey } = supabaseAdminConfig();
  if (!url || !serviceRoleKey) throw new Error("supabase_service_role_missing");
  const endpoint = new URL(`/rest/v1/${SYNC_TABLE}`, url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify([{
      source: "jarvis-site-manual-roster-refresh",
      status: "running",
      summary: {
        requested: true,
        requested_by: user.username,
        requested_at: new Date().toISOString(),
        note: "Manual refresh requested from dashboard button. Local OpenClaw worker must fetch CAE read-only roster and publish runtime documents."
      }
    }])
  });

  if (!response.ok) throw new Error(`supabase_sync_run_${response.status}`);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/", request.url), 303);
  if (!hasModule(user, "escala") || !isAdmin(user)) return redirectHome(request, { error: "forbidden" });

  try {
    await queueManualRefresh(user);
    return redirectHome(request, { roster_refresh: "queued" });
  } catch {
    return redirectHome(request, { roster_refresh: "failed" });
  }
}
