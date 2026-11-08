// Ported 1:1 from hub/prices.py. What the same product costs on Torob — only product-page
// links the team gave the panel, one page every 5 seconds: never a search or an internal API.
// No price on the site is ever changed; these numbers stay in the panel.
import * as adapters from "./adapters";
import { catalogRows } from "./catalog";
import { one, q, run } from "./db";
import type { ProjectRow } from "./projects";

const LINK = /^https:\/\/torob\.com\/p\/[0-9a-f-]{36}/;
const UA = "Mozilla/5.0 (compatible; GrowthHubPriceCheck/1.0)";
const PAUSE_MS = 5000, MAX_LINKS = 50;
const EXPENSIVE = 0.1, SUSPECT = 0.5;

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function field(html: string, ...names: string[]): number | null {
  const re = new RegExp(`\\\\?"(?:${names.join("|")})\\\\?"\\s*:\\s*\\\\?"?(\\d+(?:\\.\\d+)?)`);
  const m = re.exec(html);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v || null;
}

export type TorobPrice = { low: number; high: number | null; offers: number | null };

export function parseTorob(html: string): TorobPrice | null {
  const low = field(html, "lowPrice");
  if (!low) return null;
  const high = field(html, "highPrice"), offers = field(html, "offerCount");
  return { low: Math.floor(low / 10), high: high ? Math.floor(high / 10) : null, offers: offers ? Math.floor(offers) : null };
}

export function parseOwn(html: string): number | null {
  const value = field(html, "lowPrice", "price");
  if (!value) return null;
  const cur = /\\?"priceCurrency\\?"\s*:\s*\\?"(\w+)/.exec(html);
  return cur && cur[1] === "IRR" ? Math.floor(value / 10) : Math.floor(value);
}

export function hasLinks(pid: string): boolean {
  return !!one("SELECT 1 FROM price_links WHERE project_id=?", pid);
}

export function addLink(pid: string, url: string, torobUrl: string) {
  url = String(url || "").trim(); torobUrl = String(torobUrl || "").trim();
  if (!LINK.test(torobUrl)) throw new Error("فقط لینک صفحه محصول ترب قبول است؛ مثل torob.com/p/...");
  if (!catalogRows(pid, "product").some((r) => r.url === url)) throw new Error("این محصول در کاتالوگ سایت نیست");
  if (!one("SELECT 1 FROM price_links WHERE project_id=? AND url=?", pid, url) && one<{ n: number }>("SELECT COUNT(*) n FROM price_links WHERE project_id=?", pid)!.n >= MAX_LINKS) {
    throw new Error(`حداکثر ${MAX_LINKS} لینک مجاز است`);
  }
  run("INSERT OR REPLACE INTO price_links(project_id,url,torob_url,added) VALUES (?,?,?,?)", pid, url, torobUrl, Date.now() / 1000);
}

export function removeLink(pid: string, url: string) {
  run("DELETE FROM price_links WHERE project_id=? AND url=?", pid, url);
  run("DELETE FROM price_checks WHERE project_id=? AND url=?", pid, url);
}

function urlSlug(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, "");
    return path.split("/").pop() || "";
  } catch { return ""; }
}

/** Steve's back office keeps Torob links too; those were given by the team as well. */
async function siteLinks(pid: string) {
  if ((adapters.config(pid) || {}).type !== "steve") return;
  const bySlug = new Map(catalogRows(pid, "product").map((r) => [urlSlug(r.url), r.url]));
  let items: { slug?: string; torob_url?: string }[];
  try {
    const d = await adapters.client(pid).req("GET", "/product/competitor-links");
    items = (d.products as { slug?: string; torob_url?: string }[]) || [];
  } catch { return; }
  for (const x of items) {
    const url = x.slug ? bySlug.get(x.slug) : undefined;
    const link = x.torob_url || "";
    if (url && LINK.test(link)) run("INSERT OR IGNORE INTO price_links(project_id,url,torob_url,added) VALUES (?,?,?,?)", pid, url, link, Date.now() / 1000);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function check(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}, pauseMs = PAUSE_MS) {
  const pid = project.id;
  let ok = 0, bad = 0;
  await siteLinks(pid);
  const links = q<{ url: string; torob_url: string }>("SELECT * FROM price_links WHERE project_id=? ORDER BY added LIMIT ?", pid, MAX_LINKS);
  for (let i = 0; i < links.length; i++) {
    if (i) await sleep(pauseMs);
    const r = links[i];
    progress(i, links.length, "خواندن قیمت ترب");
    let got: TorobPrice | null = null, own: number | null = null, error = "";
    try {
      got = parseTorob(await fetchHtml(r.torob_url));
      if (!got) error = "قیمت در صفحه ترب پیدا نشد";
    } catch (e) { error = `ترب پاسخ نداد: ${String((e as Error).message || e).slice(0, 80)}`; }
    try { own = parseOwn(await fetchHtml(r.url)); } catch { /* own-site read is best-effort */ }
    run(
      "INSERT INTO price_checks(project_id,url,checked,own,low,high,offers,error) VALUES (?,?,?,?,?,?,?,?)",
      pid, r.url, Date.now() / 1000, own, got?.low ?? null, got?.high ?? null, got?.offers ?? null, error,
    );
    if (error) bad++; else ok++;
  }
  return { checked: ok, errors: bad };
}

export function status(own: number | null, low: number | null): "unknown" | "suspect" | "expensive" | "cheapest" | "near" {
  if (!own || !low) return "unknown";
  const gap = (own - low) / low;
  if (Math.abs(gap) > SUSPECT) return "suspect";
  if (gap > EXPENSIVE) return "expensive";
  return own <= low ? "cheapest" : "near";
}

type PriceCheck = { url: string; checked: number; own: number | null; low: number | null; high: number | null; offers: number | null; error: string };

export function rows(pid: string) {
  const products = new Map(catalogRows(pid, "product").map((r) => [r.url, r]));
  const checks = new Map<string, PriceCheck[]>();
  for (const c of q<PriceCheck>("SELECT * FROM price_checks WHERE project_id=? ORDER BY checked DESC", pid)) {
    if (!checks.has(c.url)) checks.set(c.url, []);
    checks.get(c.url)!.push(c);
  }
  const out: { url: string; torob_url: string; name: string; available: number | null; own: number | null; low: number | null; high: number | null; offers: number | null; low_before: number | null; checked: number | null; error: string; status: ReturnType<typeof status>; gap: number | null }[] = [];
  for (const link of q<{ url: string; torob_url: string }>("SELECT * FROM price_links WHERE project_id=?", pid)) {
    const past = checks.get(link.url) || [];
    const last = past[0];
    const before = past.slice(1).find((c) => c.low)?.low ?? null;
    const own = last?.own ?? null, low = last?.low ?? null;
    const p = products.get(link.url);
    out.push({
      url: link.url, torob_url: link.torob_url, name: p?.name || link.url, available: p?.available ?? null,
      own, low, high: last?.high ?? null, offers: last?.offers ?? null, low_before: before,
      checked: last?.checked ?? null, error: last?.error || "", status: status(own, low),
      gap: own && low ? Math.round(((own - low) / low) * 100) : null,
    });
  }
  const order = { expensive: 0, suspect: 1, near: 2, cheapest: 3, unknown: 4 };
  return out.sort((a, b) => order[a.status] - order[b.status] || (b.gap ?? 0) - (a.gap ?? 0));
}
