// Ported from server.py's guard()/access()/need(). Every Route Handler calls requireUser()
// (equivalent to guard() + the session-lookup half of access()) first, then — for a
// project-scoped resource — requireProject() (equivalent to need()). No-access returns 404,
// not 403, on purpose: it hides whether a project exists from users who aren't on it, same
// as the Python original's comment explains.
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, EXTRA_HOSTS, HTTPS, PROXY } from "./http-env";
import { role, userFromToken, SESSION_SECONDS, type Role, type User } from "./auth";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// server.ts sets this from the real TCP socket on every request — never trust any
// client-supplied version of it.
function realRemoteAddr(req: NextRequest): string {
  return req.headers.get("x-growth-hub-remote-addr") || "";
}

export function clientIp(req: NextRequest): string {
  if (PROXY) {
    const hops = (req.headers.get("x-forwarded-for") || "").split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]; // our own proxy appended the last hop; earlier ones can be forged
  }
  return realRemoteAddr(req);
}

// True only for a direct request on this machine, never through a proxy — used to gate
// first-admin bootstrap so a remotely-exposed instance can't have its first admin created
// remotely.
export function isLocal(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  return LOCAL_IPS.has(realRemoteAddr(req)) && LOCAL_HOSTS.has(host) && !req.headers.get("x-forwarded-for") && !PROXY;
}

export function guardRequest(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  if (!LOCAL_HOSTS.has(host) && !EXTRA_HOSTS.has(host)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (req.method !== "GET" && req.headers.get("x-hub") !== "1" && !req.nextUrl.pathname.startsWith("/api/agent/")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export function getToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE)?.value ?? null;
}

export function getCurrentUser(req: NextRequest): User | undefined {
  return userFromToken(getToken(req));
}

export function requireUser(req: NextRequest): { user: User } | { response: NextResponse } {
  const guarded = guardRequest(req);
  if (guarded) return { response: guarded };
  const user = getCurrentUser(req);
  if (!user) return { response: NextResponse.json({ error: "ابتدا وارد شوید" }, { status: 401 }) };
  return { user };
}

// Convenience for the common case: every project-scoped route needs both checks in order
// (session, then role-for-this-project), and most of them don't need the intermediate user
// object for anything else.
export function requireProjectAccess(req: NextRequest, pid: string, level: "view" | "edit" | "admin"): { user: User; role: Role } | { response: NextResponse } {
  const u = requireUser(req);
  if ("response" in u) return u;
  const p = requireProject(u.user, pid, level);
  if ("response" in p) return p;
  return { user: u.user, role: p.role };
}

export function requireProject(user: User, pid: string, level: "view" | "edit" | "admin"): { role: Role } | { response: NextResponse } {
  const r = role(user, pid);
  if (!r) return { response: NextResponse.json({ error: "پیدا نشد" }, { status: 404 }) };
  if (level === "admin" && r !== "admin") return { response: NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 }) };
  if (level === "edit" && r === "viewer") return { response: NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 }) };
  return { role: r };
}

export function setSessionCookie(res: NextResponse, token: string, maxAge: number = SESSION_SECONDS) {
  res.cookies.set(COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict", maxAge, secure: HTTPS });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { path: "/", httpOnly: true, sameSite: "strict", maxAge: 0, secure: HTTPS });
}
