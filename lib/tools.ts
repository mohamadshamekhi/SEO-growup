// Ported from hub/tools.py. ping() keeps its own lightweight fetch (one GET, status +
// elapsed ms) rather than going through crawl.fetchUrl(). publicUrl()/safeFetch() do use
// crawl.fetchUrl(), since check_sources() (hub/content.py) needs real redirect-hop-by-hop
// following with headers, which crawl.ts already has.
import dns from "node:dns/promises";
import net from "node:net";
import { one, run } from "./db";
import type { ProjectRow } from "./projects";
import { fetchUrl } from "./crawl";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; ms: number; error?: string }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "GrowthHub-Uptime/1.0" }, cache: "no-store" });
    // Draining the body isn't needed for a status check, but undici can otherwise hold the
    // connection open; closing it keeps consecutive pings fast.
    await res.body?.cancel().catch(() => {});
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String((e as Error).message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ping(project: ProjectRow): Promise<{ status: number; ms: number; up: boolean; changed: "up" | "down" | null }> {
  const domain = project.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const base = `https://${domain}/`;
  let r = await fetchWithTimeout(base, 20000);
  if (r.status === 0 || r.status >= 500) { await sleep(5000); r = await fetchWithTimeout(base, 20000); } // confirm before recording an outage

  run("INSERT INTO uptime VALUES (?,?,?,?)", project.id, Date.now() / 1000, r.status, r.ms);
  const up = r.status >= 200 && r.status < 400;
  const openIssue = one<{ id: number }>("SELECT id FROM issues WHERE project_id=? AND code='site_down' AND status='open'", project.id);
  let changed: "up" | "down" | null = null;
  const now = Date.now() / 1000;
  if (!up && !openIssue) {
    run(
      `INSERT INTO issues(project_id,code,url,severity,detail,status,first_seen,last_seen) VALUES(?,?,?,?,?,'open',?,?)
       ON CONFLICT(project_id,code,url) DO UPDATE SET status='open', last_seen=excluded.last_seen, detail=excluded.detail, fixed_at=NULL`,
      project.id, "site_down", base, "critical", String(r.status || r.error || ""), now, now,
    );
    changed = "down";
  } else if (up && openIssue) {
    run("UPDATE issues SET status='fixed', fixed_at=? WHERE id=?", now, openIssue.id);
    changed = "up";
  }
  return { status: r.status, ms: r.ms, up, changed };
}

// ---------- SSRF guard + redirect-following safe fetch (hub/tools.py's public_url/safe_fetch) ----------
function isGlobalIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // shared/CGNAT
    if (a >= 224) return false; // multicast/reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return false;
    if (low.startsWith("fe80:") || low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return false; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return false; // unique local
    if (low.startsWith("::ffff:")) return isGlobalIp(low.slice(7)); // IPv4-mapped
    return true;
  }
  return false;
}

/** Rejects anything that isn't a public http(s) address, so members can't make the server read internal services. */
export async function publicUrl(url: string): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("آدرس باید با http شروع شود"); }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) throw new Error("آدرس باید با http شروع شود");
  let addrs: string[];
  try { addrs = (await dns.lookup(u.hostname, { all: true })).map((a) => a.address); }
  catch { throw new Error(`دامنه پیدا نشد: ${u.hostname}`); }
  for (const ip of addrs) if (!isGlobalIp(ip)) throw new Error(`این آدرس مجاز نیست: ${u.hostname}`);
  return url;
}

/** Follows redirects itself so that every hop is checked against publicUrl(). */
export async function safeFetch(startUrl: string) {
  let url = startUrl;
  for (let i = 0; i < 5; i++) {
    await publicUrl(url);
    const r = await fetchUrl(url, "GET", false);
    if (![301, 302, 303, 307, 308].includes(r.status) || !r.headers.location) return r;
    url = new URL(r.headers.location, url).toString();
  }
  throw new Error("ریدایرکت زیادی داشت");
}
