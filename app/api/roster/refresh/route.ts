import { NextResponse } from "next/server";
import { currentUser, hasModule, isAdmin } from "../../../../lib/auth";

function redirectHome(request: Request, params: Record<string, string>) {
  const url = new URL("/", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/", request.url), 303);
  if (!hasModule(user, "escala") || !isAdmin(user)) return redirectHome(request, { error: "forbidden" });

  return redirectHome(request, { roster_refresh: "disabled" });
}
