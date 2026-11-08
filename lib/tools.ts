// Ported from hub/tools.py. ping() keeps its own lightweight fetch (one GET, status +
// elapsed ms) rather than going through crawl.fetchUrl(). publicUrl()/safeFetch() do use
// crawl.fetchUrl(), since check_sources() (hub/content.py) needs real redirect-hop-by-hop
// following with headers, which crawl.ts already has.
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { DATA_DIR, one, run } from "./db";
import type { ProjectRow } from "./projects";
import { fetchUrl, ldTypes, parsePage, contentWords } from "./crawl";

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

// ---------- competitor compare (ported from hub/tools.py) ----------
export type PageAnalysis = {
  url: string; status: number; ms?: number; kb?: number; title?: string; title_len?: number; description?: string;
  h1?: number; h2?: string[]; words?: number; images?: number; images_no_alt?: number; internal_links?: number;
  schema?: string[]; faq?: boolean; og_image?: boolean; has_table?: boolean; has_video?: boolean; error?: string;
};

export async function analyze(url: string): Promise<PageAnalysis> {
  const r = await safeFetch(url);
  if (r.status !== 200) return { url, status: r.status, error: r.error || "" };
  const p = parsePage(r.body);
  const { types } = ldTypes(p.ld);
  const h2 = [...r.body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>|\s+/g, " ").trim()).filter(Boolean).slice(0, 25);
  let host: string;
  try { host = new URL(r.final).hostname.replace(/^www\./, ""); } catch { host = ""; }
  let inner = 0;
  for (const a of p.a) {
    try { if (new URL(a, r.final).hostname.replace(/^www\./, "") === host) inner++; } catch { /* relative/invalid href */ }
  }
  return {
    url: decodeURIComponent(r.final), status: r.status, ms: r.ms, kb: Math.floor(r.bytes / 1024),
    title: p.title, title_len: p.title.length, description: p.meta.description || "",
    h1: p.h1, h2, words: contentWords(p), images: p.imgs.length,
    images_no_alt: p.imgs.filter((i) => !(i.alt || "").trim()).length, internal_links: inner,
    schema: types, faq: types.some((t) => t.includes("FAQ")), og_image: !!p.meta["og:image"],
    has_table: r.body.toLowerCase().includes("<table"), has_video: /<video|youtube\.com\/embed|aparat\.com/i.test(r.body),
  };
}

export async function compare(projectId: string, mine: string, others: string[]) {
  const data: { mine: PageAnalysis; others: PageAnalysis[]; tips: string[]; missing_topics?: string[] } = { mine: await analyze(mine), others: [], tips: [] };
  for (const u of others.slice(0, 5)) {
    await sleep(1000);
    data.others.push(await analyze(u));
  }
  const tips: string[] = [];
  const m = data.mine, os_ = data.others.filter((o) => o.status === 200);
  if (m.status === 200 && os_.length) {
    const avg = (k: keyof PageAnalysis) => os_.reduce((s, o) => s + (Number(o[k]) || 0), 0) / os_.length;
    if ((m.words || 0) < avg("words") * 0.7) tips.push(`محتوای شما ${m.words} کلمه است؛ میانگین رقبا ${Math.trunc(avg("words"))}. بخش‌های جاافتاده را از H2های رقبا ببینید.`);
    if ((m.h2?.length || 0) < os_.reduce((s, o) => s + (o.h2?.length || 0), 0) / os_.length * 0.6) tips.push("ساختار تیترهای شما (H2) کمتر از رقباست.");
    if (os_.some((o) => o.faq) && !m.faq) tips.push("رقبا اسکیمای FAQ دارند؛ شما ندارید.");
    if (os_.some((o) => o.has_table) && !m.has_table) tips.push("رقبا جدول مقایسه دارند.");
    if (os_.some((o) => o.has_video) && !m.has_video) tips.push("رقبا ویدیو دارند.");
    if ((m.internal_links || 0) < avg("internal_links") * 0.5) tips.push("لینک داخلی شما خیلی کمتر از رقباست.");
    if ((m.ms || 0) > Math.min(...os_.map((o) => o.ms || Infinity)) * 2) tips.push("صفحه شما به‌طور محسوس کندتر از رقباست.");
    const mineH2 = (m.h2 || []).join(" ").toLowerCase();
    const missing: string[] = [];
    for (const o of os_) {
      for (const h of o.h2 || []) {
        const words = h.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        if (words.length && !words.some((w) => mineH2.includes(w)) && !missing.includes(h)) missing.push(h);
      }
    }
    data.missing_topics = missing.slice(0, 15);
  }
  data.tips = tips;
  const id = run("INSERT INTO compares(project_id, ts, data) VALUES (?,?,?)", projectId, Date.now() / 1000, JSON.stringify(data)).lastInsertRowid;
  return { id, ...data };
}

// ---------- images ----------
export async function ogImage(pageUrl: string): Promise<string | null> {
  const r = await safeFetch(pageUrl);
  const p = parsePage(r.body);
  const img = p.meta["og:image"];
  return img ? new URL(img, r.final).toString() : null;
}

export function shade(hexcol: string, f: number): string {
  const h = hexcol.replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = f < 1 ? (c: number) => c * f : (c: number) => c + (255 - c) * (f - 1);
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.trunc(mix(c))));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;
}

const SIZES: Record<string, [number, number]> = { cover: [1200, 675], og: [1200, 630], post: [1080, 1350], story: [1080, 1920] };

function findChrome(): string {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.env.HUB_CHROME) return process.env.HUB_CHROME;
  if (fs.existsSync(macChrome)) return macChrome;
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const p = execSync(`which ${name}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (p) return p;
    } catch { /* not found; try next */ }
  }
  return macChrome;
}

function escapeHtmlAttr(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type ImageSpec = {
  template?: "cover" | "og" | "post" | "story"; images?: string[]; pages?: string[]; theme?: "brand" | "dark" | "light";
  accent?: string; title?: string; subtitle?: string; badge?: string; footer?: string;
};

/** Branded image rendering via a real headless browser (Playwright driving the system's
 * installed Chrome/Chromium — Playwright's own bundled-browser download is geo-blocked in
 * this environment, so executablePath always points at an already-installed browser, same
 * HUB_CHROME-env-first fallback chain as Python's CHROME constant). */
export async function renderImage(project: ProjectRow, spec: ImageSpec): Promise<{ id: number | bigint; file: string }> {
  const t = spec.template || "cover";
  const [w, h] = SIZES[t];
  let images = (spec.images || []).filter((u) => u.startsWith("http")).slice(0, 3);
  for (const page of (spec.pages || []).slice(0, 3)) {
    const img = await ogImage(page);
    if (img) images.push(img);
  }
  images = images.slice(0, 3);
  if (!images.length) throw new Error("هیچ عکسی پیدا نشد (آدرس عکس یا صفحه‌ای با og:image بدهید)");
  const col = project.color || "#5a4fcf";
  const theme = spec.theme || "brand";
  const THEMES: Record<string, [string, string, string, string]> = {
    brand: [shade(col, 0.45), col, "#fff", spec.accent || "#ed1944"],
    dark: ["#0b0b14", shade(col, 0.5), "#fff", col],
    light: [shade(col, 1.92), shade(col, 1.75), shade(col, 0.4), col],
  };
  const [bg1, bg2, fg, accent] = THEMES[theme];
  const vertical = h > w;
  const n = images.length;
  const title = spec.title || "", subtitle = spec.subtitle || "", badge = spec.badge || "";
  let tsize = { cover: 64, og: 60, post: 84, story: 96 }[t];
  if (title.length > 40) tsize = Math.trunc(tsize * 0.8);
  if (title.length > 70) tsize = Math.trunc(tsize * 0.82);
  const logo = project.logo_url || "";
  const footer = spec.footer || project.domain;
  const cards = images.map((u) => `<div class="ph"><img src="${escapeHtmlAttr(u)}" alt=""></div>`).join("");
  const page = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0} html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:Vazirmatn,sans-serif;color:${fg};background:radial-gradient(circle at ${vertical ? "50% 30%" : "22% 50%"},${bg2} 0%,${bg1} 72%);
display:flex;flex-direction:${vertical ? "column" : "row"};padding:${vertical ? "90px 80px 110px" : "64px 72px"};gap:${vertical ? "48px" : "40px"};position:relative}
body::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.07) 1.5px,transparent 1.5px);background-size:28px 28px}
.text{flex:${vertical ? "0 0 auto" : "1 1 52%"};display:flex;flex-direction:column;justify-content:${vertical ? "flex-start" : "center"};gap:22px;position:relative;z-index:1}
.logo{height:${vertical ? 80 : 54}px;align-self:flex-start;background:#fff;padding:10px 16px;border-radius:16px;box-sizing:content-box}
.brand{align-self:flex-start;font-weight:900;font-size:${vertical ? 40 : 30}px}
.badge{align-self:flex-start;background:${accent};color:#fff;font-weight:700;font-size:${vertical ? 34 : 26}px;padding:6px 24px;border-radius:99px}
h1{font-weight:900;font-size:${tsize}px;line-height:1.35;text-wrap:balance} p{font-size:${vertical ? 40 : 30}px;opacity:.85;line-height:1.6}
.media{flex:1 1 ${vertical ? "0" : "48%"};position:relative;z-index:1;display:${n === 1 ? "grid" : "flex"};place-items:center;align-items:center;gap:18px;min-height:0}
.ph{background:#fff;border-radius:28px;box-shadow:0 30px 60px rgba(0,0,0,.35);border:8px solid #fff;overflow:hidden;aspect-ratio:1;
${vertical && n === 1 ? `height:${n === 1 ? "100%" : "72%"};width:auto;max-width:100%` : n === 1 ? "width:86%" : "flex:1 1 0"}}
.ph:nth-child(2):not(:last-child){transform:scale(1.12);z-index:2} .ph img{width:100%;height:100%;object-fit:cover;border-radius:20px}
.foot{position:absolute;bottom:${vertical ? 44 : 26}px;inset-inline:0;text-align:center;font-size:${vertical ? 30 : 20}px;opacity:.7;z-index:1;direction:ltr}
</style></head><body>
<div class="text">${logo ? `<img class="logo" src="${escapeHtmlAttr(logo)}" alt="">` : `<span class="brand">${escapeHtmlAttr(project.name)}</span>`}
${badge ? `<span class="badge">${escapeHtmlAttr(badge)}</span>` : ""}<h1>${escapeHtmlAttr(title)}</h1>${subtitle ? `<p>${escapeHtmlAttr(subtitle)}</p>` : ""}</div>
<div class="media">${cards}</div>${footer ? `<div class="foot">${escapeHtmlAttr(footer)}</div>` : ""}</body></html>`;

  const outDir = path.join(DATA_DIR, "images", project.id);
  fs.mkdirSync(outDir, { recursive: true });
  const slug = title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "image";
  const now2 = new Date();
  const stamp = `${now2.getFullYear()}${String(now2.getMonth() + 1).padStart(2, "0")}${String(now2.getDate()).padStart(2, "0")}-${String(now2.getHours()).padStart(2, "0")}${String(now2.getMinutes()).padStart(2, "0")}${String(now2.getSeconds()).padStart(2, "0")}`;
  const outFile = path.join(outDir, `${stamp}_${t}_${slug}.png`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: w, height: h } });
    await browserPage.setContent(page, { waitUntil: "networkidle", timeout: 30_000 });
    await browserPage.screenshot({ path: outFile, timeout: 30_000 });
  } finally {
    await browser.close();
  }

  const rel = path.relative(DATA_DIR, outFile).split(path.sep).join("/");
  const iid = run("INSERT INTO images(project_id, ts, file, spec) VALUES (?,?,?,?)", project.id, Date.now() / 1000, rel, JSON.stringify({ ...spec, images })).lastInsertRowid;
  return { id: iid, file: rel };
}
