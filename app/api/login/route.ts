import { NextResponse } from "next/server";
import { createSession, getUsers, hashPassword, SESSION_COOKIE } from "../../../lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/");

  const user = getUsers().find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user || user.passwordHash !== hashPassword(password)) {
    return NextResponse.redirect(new URL(`/login?error=1&username=${encodeURIComponent(username)}`, request.url));
  }

  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", request.url));
  response.cookies.set(SESSION_COOKIE, createSession(user.username), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });
  return response;
}
