// Ported 1:1 from hub/auth.py. Same scrypt params (so existing password hashes in hub.db
// stay valid — no re-hash/migration needed), same session-token-hash-only storage, same
// brute-force lockout shape, same admin/editor/viewer role resolution. TOTP 2FA setup/enable/
// disable endpoints (hub/auth.py's own setup flow, not hub/extras.py's totp_* primitives,
// which are now ported in lib/extras.ts and used by login() below) are still not wired to a
// route.
import crypto from "node:crypto";
import { one, run } from "./db";
import { totpOk } from "./extras";
import { projects as allProjects } from "./projects";

export const SESSION_SECONDS = 14 * 86400;
const MAX_FAILS = 5;
const LOCK_SECONDS = 300;
const MAX_FAILS_PER_USER = 20;
const N = 2 ** 15, R = 8, P = 1, MAXMEM = 64 * 1024 * 1024, DKLEN = 64;

export class NeedCode extends Error {}

export type User = {
  id: number; username: string; name: string; pass_hash: string;
  is_admin: number; active: number; created_at: number; last_login: number | null;
  telegram_chat: string; totp_secret: string; totp_pending: string; recovery: string;
};

function scrypt(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, DKLEN, { N, r: R, p: P, maxmem: MAXMEM });
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}$${scrypt(password, salt).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [saltHex, digestHex] = stored.split("$");
  const got = scrypt(password, Buffer.from(saltHex, "hex")).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(digestHex));
}

// Keeps unknown usernames exactly as slow as a wrong password, so login timing can't be
// used to probe which usernames exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function cleanUsername(u: string): string {
  const v = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(v)) throw new Error("نام کاربری باید ۳ تا ۳۲ حرف انگلیسی، عدد، نقطه یا خط تیره باشد");
  return v;
}

export function cleanPassword(p: string): string {
  const v = String(p || "");
  if (v.length < 8) throw new Error("رمز باید حداقل ۸ کاراکتر باشد");
  if (v.length > 200) throw new Error("رمز خیلی بلند است");
  return v;
}

export function publicUser(u: User) {
  return { id: u.id, username: u.username, name: u.name, is_admin: !!u.is_admin, active: !!u.active, last_login: u.last_login, telegram_chat: u.telegram_chat, totp: !!u.totp_secret };
}

export function createUser(name: string, username: string, password: string, isAdmin = false): number {
  const cleanName = String(name || "").trim().slice(0, 80);
  if (!cleanName) throw new Error("نام لازم است");
  const uname = cleanUsername(username);
  if (one("SELECT 1 FROM users WHERE username=?", uname)) throw new Error("این نام کاربری قبلاً ثبت شده");
  const info = run(
    "INSERT INTO users(username,name,pass_hash,is_admin,active,created_at) VALUES (?,?,?,?,1,?)",
    uname, cleanName, hashPassword(cleanPassword(password)), isAdmin ? 1 : 0, Date.now() / 1000,
  );
  return Number(info.lastInsertRowid);
}

export function needsSetup(): boolean {
  return !one("SELECT 1 FROM users LIMIT 1");
}

// In-memory per-(username,ip) and per-username fail counters — valid for a single-process
// deploy, same as the Python original (it was never meant to survive horizontal scaling).
const fails = new Map<string, number[]>();

function keyOf(username: string, ip: string) {
  return `${String(username || "").trim().toLowerCase().slice(0, 40)}\u0000${ip}`;
}

export function login(username: string, password: string, ip: string, code?: string): string {
  const user = String(username || "").trim().toLowerCase().slice(0, 40);
  const key = keyOf(username, ip);
  const now = Date.now() / 1000;
  const recent = (fails.get(key) || []).filter((t) => now - t < LOCK_SECONDS);
  fails.set(key, recent);
  let sameUser = 0;
  for (const [k, v] of fails) if (k.split("\u0000")[0] === user) sameUser += v.filter((t) => now - t < LOCK_SECONDS).length;
  if (recent.length >= MAX_FAILS || sameUser >= MAX_FAILS_PER_USER) throw new Error("تلاش زیاد بود؛ ۵ دقیقه دیگر دوباره امتحان کنید");

  const u = one<User>("SELECT * FROM users WHERE username=?", user);
  const ok = checkPassword(String(password || ""), u ? u.pass_hash : DUMMY_HASH);
  if (!(ok && u && u.active)) {
    fails.set(key, [...recent, now]);
    throw new Error("نام کاربری یا رمز درست نیست");
  }
  if (u.totp_secret) {
    if (!code) throw new NeedCode();
    if (!(totpOk(u.totp_secret, code) || useRecovery(u, code))) {
      fails.set(key, [...recent, now]);
      throw new Error("کد ورود دومرحله‌ای درست نیست");
    }
  }
  fails.delete(key);
  run("UPDATE users SET last_login=? WHERE id=?", now, u.id);
  return newSession(u.id);
}

function useRecovery(u: User, code: string): boolean {
  const digest = crypto.createHash("sha256").update(String(code).trim().toLowerCase()).digest("hex");
  const left: string[] = JSON.parse(u.recovery || "[]");
  const idx = left.indexOf(digest);
  if (idx < 0) return false;
  left.splice(idx, 1);
  run("UPDATE users SET recovery=? WHERE id=?", JSON.stringify(left), u.id);
  return true;
}

function digest(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now() / 1000;
  run("DELETE FROM sessions WHERE expires<?", now);
  run("INSERT INTO sessions(token_hash,user_id,expires) VALUES (?,?,?)", digest(token), userId, now + SESSION_SECONDS);
  return token;
}

export function userFromToken(token: string | null): User | undefined {
  if (!token) return undefined;
  return one<User>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1`,
    digest(token), Date.now() / 1000,
  );
}

export function endSession(token: string | null) {
  if (token) run("DELETE FROM sessions WHERE token_hash=?", digest(token));
}

export function endAllSessions(userId: number, keepToken?: string) {
  run("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", userId, keepToken ? digest(keepToken) : "");
}

export type Role = "admin" | "editor" | "viewer" | null;

export function role(user: User, projectId: string): Role {
  if (user.is_admin) return "admin";
  const r = one<{ role: Role }>("SELECT role FROM members WHERE user_id=? AND project_id=?", user.id, projectId);
  return r ? r.role : null;
}

export function visibleProjects(user: User) {
  return allProjects().filter((p) => role(user, p.id));
}
