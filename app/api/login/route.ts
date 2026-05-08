import { NextResponse } from "next/server";
import { createSession, getUsers, hashPassword, SESSION_COOKIE } from "../../../lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/");

  const user = getUsers().find((candidate) => candidate.email.toLowerCase() === email);
  if (!user || user.passwordHash !== hashPassword(password)) {
    return NextResponse.redirect(new URL(`/login?error=1&email=${encodeURIComponent(email)}`, request.url));
  }

  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", request.url));
  response.cookies.set(SESSION_COOKIE, createSession(user.email), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });
  return response;
}
