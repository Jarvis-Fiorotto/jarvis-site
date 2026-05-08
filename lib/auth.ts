import crypto from "crypto";
import { cookies } from "next/headers";

export type AppUser = {
  email: string;
  name: string;
  passwordHash: string;
};

export const SESSION_COOKIE = "jarvis_schedule_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function secret() {
  return process.env.AUTH_SECRET || "dev-secret-change-me";
}

export function hashPassword(password: string) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function getUsers(): AppUser[] {
  try {
    const raw = process.env.SCHEDULE_USERS_JSON || "[]";
    const users = JSON.parse(raw) as AppUser[];
    return users.filter((user) => user.email && user.name && user.passwordHash);
  } catch {
    return [];
  }
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSession(email: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ email, expires })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSession(token?: string) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email: string;
      expires: number;
    };
    if (!data.email || !data.expires || data.expires < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function currentUser() {
  const cookieStore = await cookies();
  const session = readSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return getUsers().find((user) => user.email.toLowerCase() === session.email.toLowerCase()) || null;
}
