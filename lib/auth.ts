import crypto from "crypto";
import { cookies } from "next/headers";

export type UserRole = "admin" | "viewer";
export type UserModule = "escala" | "agenda" | "briefing" | "financas" | "viagens" | "admin";

export type AppUser = {
  username: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  modules: UserModule[];
};

type RawAppUser = Partial<Omit<AppUser, "modules">> & {
  email?: string;
  modules?: string[];
};

const ADMIN_MODULES: UserModule[] = ["escala", "agenda", "briefing", "financas", "viagens", "admin"];
const LIMITED_MODULES: UserModule[] = ["escala", "agenda"];
const KNOWN_LIMITED_USERS = new Set(["bruna", "rene", "rené"]);

export const SESSION_COOKIE = "jarvis_schedule_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function secret() {
  return process.env.AUTH_SECRET || "dev-secret-change-me";
}

export function hashPassword(password: string) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function normalizeModule(value: string): UserModule | null {
  const normalized = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["escala", "schedule"].includes(normalized)) return "escala";
  if (["agenda", "calendar"].includes(normalized)) return "agenda";
  if (["briefing"].includes(normalized)) return "briefing";
  if (["financas", "finance", "finances"].includes(normalized)) return "financas";
  if (["viagens", "travel", "trips"].includes(normalized)) return "viagens";
  if (["admin", "administracao", "administration"].includes(normalized)) return "admin";
  return null;
}

function inferRole(user: RawAppUser): UserRole {
  if (user.role === "viewer" || user.role === "admin") return user.role;
  const identity = `${user.username || user.email || ""} ${user.name || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return [...KNOWN_LIMITED_USERS].some((known) => identity.includes(known.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) ? "viewer" : "admin";
}

function modulesFor(user: RawAppUser, role: UserRole): UserModule[] {
  if (Array.isArray(user.modules) && user.modules.length) {
    const modules = user.modules.map(String).map(normalizeModule).filter(Boolean) as UserModule[];
    return [...new Set(modules)];
  }
  return role === "admin" ? ADMIN_MODULES : LIMITED_MODULES;
}

export function hasModule(user: Pick<AppUser, "modules">, module: UserModule) {
  return user.modules.includes(module);
}

export function isAdmin(user: Pick<AppUser, "role" | "modules">) {
  return user.role === "admin" || user.modules.includes("admin");
}

export function getUsers(): AppUser[] {
  try {
    const raw = process.env.SCHEDULE_USERS_JSON || "[]";
    const users = JSON.parse(raw) as RawAppUser[];
    return users
      .map((user) => {
        const role = inferRole(user);
        return {
          username: String(user.username || user.email || "").trim(),
          name: String(user.name || user.username || user.email || "").trim(),
          passwordHash: String(user.passwordHash || "").trim(),
          role,
          modules: modulesFor(user, role)
        };
      })
      .filter((user) => user.username && user.name && user.passwordHash);
  } catch {
    return [];
  }
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSession(username: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ username, expires })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSession(token?: string) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: string;
      email?: string;
      expires: number;
    };
    const username = data.username || data.email;
    if (!username || !data.expires || data.expires < Math.floor(Date.now() / 1000)) return null;
    return { username, expires: data.expires };
  } catch {
    return null;
  }
}

export async function currentUser() {
  const cookieStore = await cookies();
  const session = readSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return getUsers().find((user) => user.username.toLowerCase() === session.username.toLowerCase()) || null;
}
