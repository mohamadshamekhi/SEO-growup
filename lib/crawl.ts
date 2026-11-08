// Ported from hub/crawl.py — the technical SEO audit engine: robots.txt/sitemap handling, a
// polite 1-request/second crawl, per-page checks against the CHECKS table (lib/checks.ts),
// and score/issue reconciliation. Python hand-rolled an HTML parser on stdlib's HTMLParser;
// here `htmlparser2` (SAX-style, same shape: onopentag/onclosetag/ontext callbacks) plays
// the identical role rather than reinventing HTML tokenization by hand.
import { Parser } from "htmlparser2";
import { many, q, run, now as dbNow } from "./db";
import { CHECKS } from "./checks";
import type { ProjectRow } from "./projects";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X) GrowthHubAudit/1.0";
const DELAY_MS = 1000;
const PRODUCT_SEG = new Set(["product", "products", "p", "shop", "item", "car", "cars", "ad", "ads"]);
const ARTICLE_SEG = new Set(["blog", "mag", "article", "articles", "news", "post", "posts"]);

// Whole-site checks and link checks have no page of their own to read again.
const SITE_CODES = new Set(["no_hsts", "no_https_redirect", "www_inconsistent", "no_compression", "no_robots", "robots_blocks_all", "no_sitemap", "sitemap_duplicates", "sitemap_host_mismatch"]);
const LINK_CODES = new Set(["not_in_sitemap", "broken_link"]);
const MANAGED_CODES = new Set(["site_down", "not_indexed", "sitemap_not_submitted"]); // the uptime monitor and the index check own these
const RECHECK_LIMIT = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Comparison key: decoded, no fragment/trailing slash, www-insensitive (host variants are checked separately). */
export function U(u: string | null | undefined): string {
  try {
    return decodeURIComponent(u || "").split("#")[0].replace(/\/$/, "").replace("://www.", "://");
  } catch {
    return (u || "").split("#")[0].replace(/\/$/, "").replace("://www.", "://");
  }
}

function enc(url: string): string {
  try { return encodeURI(decodeURIComponent(url)); } catch { return url; }
}

export type FetchResult = { status: number; body: string; ms: number; final: string; headers: Record<string, string>; bytes: number; error?: string };

export async function fetchUrl(url: string, method: "GET" | "HEAD" = "GET", follow = true, timeoutMs = 25000): Promise<FetchResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(enc(url), {
      method, redirect: follow ? "follow" : "manual", signal: controller.signal, cache: "no-store",
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip" },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    // A manual (non-follow) redirect response has status in [300,399] and no readable body.
    const isRedirectNoFollow = !follow && res.status >= 300 && res.status < 400;
    let bytes = 0, body = "";
    if (method !== "HEAD" && !isRedirectNoFollow) {
      // Unlike Python's urllib (which needs manual gzip.decompress()), Node's fetch
      // (undici) transparently decodes gzip/br itself — the body below is already
      // decompressed even though the `content-encoding` response header still says gzip.
      // Decompressing it again threw "incorrect header check" (zlib on non-gzip input),
      // found by running this against the real site. `bytes` is the decompressed size
      // either way, matching Python's len(raw)-after-decompress semantics.
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf.length;
      body = buf.toString("utf-8");
    }
    return { status: res.status, body, ms: Date.now() - t0, final: res.url || url, headers, bytes };
  } catch (e) {
    return { status: 0, body: "", ms: Date.now() - t0, final: url, headers: {}, bytes: 0, error: String((e as Error).message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- HTML parsing (mirrors hub/crawl.py's Page(HTMLParser)) ----------
export type ParsedPage = {
  title: string; meta: Record<string, string>; links: Record<string, string[]>; h1: number;
  imgs: { alt?: string; role?: string; src?: string }[]; ld: string[]; a: string[]; text: string[]; mainText: string[];
};

export function parsePage(html: string): ParsedPage {
  const p: ParsedPage = { title: "", meta: {}, links: {}, h1: 0, imgs: [], ld: [], a: [], text: [], mainText: [] };
  let inTitle = false, titleBuf = "";
  let inLd = false, ldBuf = "";
  let skipDepth = 0, mainDepth = 0;

  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === "script" || tag === "style" || tag === "noscript") {
        if (tag === "script" && (attrs.type || "") === "application/ld+json") { inLd = true; ldBuf = ""; }
        else skipDepth++;
      } else if (tag === "main" || tag === "article") mainDepth++;
      else if (tag === "title" && !p.title) { inTitle = true; titleBuf = ""; }
      else if (tag === "h1") p.h1++;
      else if (tag === "meta") {
        const k = (attrs.name || attrs.property || "").toLowerCase();
        if (k) p.meta[k] = attrs.content || "";
      } else if (tag === "link" && attrs.rel) {
        const rel = attrs.rel.toLowerCase();
        (p.links[rel] ??= []).push(attrs.href || "");
      } else if (tag === "img") p.imgs.push({ alt: attrs.alt, role: attrs.role, src: attrs.src });
      else if (tag === "a" && attrs.href) p.a.push(attrs.href);
    },
    onclosetag(tag) {
      if (tag === "title" && inTitle) { p.title = titleBuf.trim(); inTitle = false; }
      else if (tag === "script" && inLd) { p.ld.push(ldBuf); inLd = false; }
      else if ((tag === "script" || tag === "style" || tag === "noscript") && skipDepth) skipDepth--;
      else if ((tag === "main" || tag === "article") && mainDepth) mainDepth--;
    },
    ontext(data) {
      if (inTitle) titleBuf += data;
      else if (inLd) ldBuf += data;
      else if (!skipDepth) {
        p.text.push(data);
        if (mainDepth) p.mainText.push(data);
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });

  try { parser.write(html); parser.end(); } catch { /* malformed HTML: use whatever was parsed so far, same tolerance as Python's HTMLParser */ }
  return p;
}

/** Words in <main>/<article> when present (excludes menus/footers), else the whole page. */
export function contentWords(p: ParsedPage): number {
  const main = p.mainText.join(" ").split(/\s+/).filter(Boolean).length;
  return main >= 50 ? main : p.text.join(" ").split(/\s+/).filter(Boolean).length;
}

export function ldTypes(blocks: string[]): { types: string[]; bad: boolean } {
  const types = new Set<string>();
  let bad = false;
  const walk = (o: unknown) => {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const t = (o as Record<string, unknown>)["@type"];
      if (t) (Array.isArray(t) ? t : [t]).forEach((x) => types.add(String(x)));
      for (const v of Object.values(o as Record<string, unknown>)) walk(v);
    } else if (Array.isArray(o)) {
      for (const v of o) walk(v);
    }
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b)); } catch { bad = true; }
  }
  return { types: [...types].sort(), bad };
}

export function pageKind(url: string, _base: string): "home" | "product" | "listing" | "article" | "static" {
  void _base;
  const path = new URL(url).pathname.replace(/^\/|\/$/g, "");
  if (!path) return "home";
  const seg = decodeURIComponent(path).split("/");
  const first = seg[0].toLowerCase();
  if (PRODUCT_SEG.has(first)) return seg.length === 2 && !["category", "price-range", "brand"].includes(seg[1]) ? "product" : "listing";
  if (ARTICLE_SEG.has(first)) return seg.length >= 2 ? "article" : "listing";
  if (["category", "categories", "brand", "brands", "tag"].includes(first)) return "listing";
  return "static";
}

export async function sitemapUrls(smUrl: string, log: (m: string) => void, depth = 0): Promise<string[] | null> {
  const r = await fetchUrl(smUrl);
  await sleep(DELAY_MS);
  if (r.status !== 200) return null;
  const locs = [...r.body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((m) => m[1]);
  if (r.body.includes("<sitemapindex") && depth < 5) {
    const out: string[] = [];
    for (const s of locs.slice(0, 30)) {
      log(`sitemap: ${s}`);
      const sub = await sitemapUrls(s, log, depth + 1);
      if (sub) out.push(...sub);
    }
    return out;
  }
  return locs;
}

/** Home first, then an even spread across sections so big catalogs don't crowd out other page types. */
export function sample(urls: string[], base: string, limit: number): string[] {
  const groups = new Map<string, string[]>();
  for (const u of urls) {
    const kind = pageKind(u, base);
    const key = kind === "home" ? "home:" : `${kind}:${new URL(u).pathname.replace(/^\/|\/$/g, "").split("/")[0]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(u);
  }
  const order = [...groups.keys()].sort((a, b) => Number(a !== "home:") - Number(b !== "home:") || groups.get(a)!.length - groups.get(b)!.length);
  const picked: string[] = [];
  let i = 0;
  while (picked.length < limit && [...groups.values()].some((g) => g.length)) {
    const k = order[i % order.length];
    const lst = groups.get(k)!;
    if (lst.length) {
      const idx = lst.length > 2 && i >= order.length ? Math.floor(lst.length / 2) : 0;
      picked.push(lst.splice(idx, 1)[0]);
    }
    i++;
    if (i > limit * 50) break;
  }
  return picked;
}

export type PageRecord = {
  url: string; kind: string; status: number; ms: number; kb: number;
  title?: string; title_len?: number; desc_len?: number; canonical?: string; h1_count?: number; words?: number;
  imgs?: number; imgs_no_alt?: number; jsonld?: string[]; og_image?: number; noindex?: number;
  inlinks?: number; outlinks?: number; issues?: number;
};

export type Found = [code: string, url: string, detail: string];

export type AuditResult = { score: number; found: Found[]; pages: PageRecord[]; summary: Record<string, unknown>; log: string[] };

export async function audit(project: ProjectRow, progress: (k: { done?: number; total?: number; message?: string }) => void = () => {}, onlyOpen = false): Promise<AuditResult> {
  const base = "https://" + project.domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const host = new URL(base).host;
  const found: Found[] = [];
  const logLines: string[] = [];
  const log = (m: string) => { logLines.push(m); progress({ message: m }); };
  const add = (code: string, url = "", detail: unknown = "") => found.push([code, url, String(detail).slice(0, 300)]);

  // --- site level ---
  let home = await fetchUrl(base + "/"); await sleep(DELAY_MS);
  if (home.status === 0 || home.status >= 500) { await sleep(5000); home = await fetchUrl(base + "/"); await sleep(DELAY_MS); }
  if (home.status === 0 || home.status >= 500) {
    add("site_down", base, home.error || home.status);
    return finish(found, [], { error: "site down" }, logLines);
  }
  const hdr = home.headers;
  if (!("strict-transport-security" in hdr)) add("no_hsts", base);
  const plain = await fetchUrl("http://" + host + "/", "GET", false); await sleep(DELAY_MS);
  const loc = plain.headers.location || "";
  if (plain.status === 200 || ([301, 302, 307, 308].includes(plain.status) && !loc.startsWith("https"))) add("no_https_redirect", "http://" + host);
  const altHost = host.startsWith("www.") ? host.slice(4) : "www." + host;
  const alt = await fetchUrl("https://" + altHost + "/", "GET", false); await sleep(DELAY_MS);
  if (alt.status === 200) add("www_inconsistent", "https://" + altHost);
  const gz = await fetchUrl(base + "/", "HEAD"); await sleep(DELAY_MS);
  if (!(gz.headers["content-encoding"] || hdr["content-encoding"])) add("no_compression", base);

  const rb = await fetchUrl(base + "/robots.txt"); await sleep(DELAY_MS);
  let smFromRobots: string[] = [];
  if (rb.status !== 200) add("no_robots", base + "/robots.txt");
  else {
    smFromRobots = [...rb.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    const block = /user-agent:\s*\*\s*(?:\n(?!user-agent).*)*?\n\s*disallow:\s*\/\s*$/im.test(rb.body);
    if (block) add("robots_blocks_all", base + "/robots.txt");
  }
  const sm = project.sitemap || smFromRobots[0] || base + "/sitemap.xml";
  log(`sitemap: ${sm}`);
  let urls = await sitemapUrls(sm, log);
  if (urls === null) { add("no_sitemap", sm); urls = []; }
  const uniqueCount = new Set(urls).size;
  if (urls.length !== uniqueCount) add("sitemap_duplicates", sm, `${urls.length - uniqueCount} تکراری`);
  urls = [...new Set(urls)];
  const finalHost = (() => { try { return new URL(home.final).host; } catch { return ""; } })();
  const hostCounts = new Map<string, number>();
  for (const u of urls) { try { const h = new URL(u).host; hostCounts.set(h, (hostCounts.get(h) || 0) + 1); } catch { /* skip */ } }
  const topHost = [...hostCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (urls.length && finalHost && topHost && topHost[0] !== finalHost) add("sitemap_host_mismatch", sm, `sitemap: ${topHost[0]} / سایت: ${finalHost}`);
  const sitemapSet = new Set(urls.map(U));
  const maxPages = project.max_pages || 120;
  let targets = urls.length ? sample(urls, base, maxPages) : [base + "/"];
  if (!targets.some((t) => U(t) === U(base))) targets.unshift(base + "/");

  // Pages with an open issue are always read again; otherwise a sampled crawl could never confirm their fix.
  const stillOpen = q<{ code: string; url: string }>("SELECT code, url FROM issues WHERE project_id=? AND status='open'", project.id);
  if (onlyOpen) targets = [base + "/"];
  const have = new Set(targets.map(U));
  const again = [...new Set(stillOpen.filter((r) => !SITE_CODES.has(r.code) && !LINK_CODES.has(r.code) && !MANAGED_CODES.has(r.code) && !have.has(U(r.url))).map((r) => r.url))];
  targets.push(...again.slice(0, RECHECK_LIMIT));

  // --- crawl ---
  const pages: PageRecord[] = [];
  const titles = new Map<string, string[]>(), descs = new Map<string, string[]>();
  const linksTo = new Map<string, number>();
  const internal = new Set<string>();
  let netErrors = 0;

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    progress({ done: i, total: targets.length, message: decodeURIComponent(url) });
    let r = await fetchUrl(url); await sleep(DELAY_MS);
    if (r.status === 0) { await sleep(5000); r = await fetchUrl(url); await sleep(DELAY_MS); }
    const kind = pageKind(url, base);
    const rec: PageRecord = { url: U(url) || base, kind, status: r.status, ms: r.ms, kb: Math.floor(r.bytes / 1024) };
    pages.push(rec);
    const inSm = sitemapSet.has(U(url));
    if (r.status === 0) { netErrors++; continue; }
    if (r.status !== 200) { add("non_200", url, r.status); continue; }
    if (inSm && U(r.final) !== U(url)) add("redirect_in_sitemap", url, decodeURIComponent(r.final));

    const p = parsePage(r.body);
    const desc = (p.meta.description || "").trim();
    const canon = (p.links.canonical || [""])[0];
    const { types, bad } = ldTypes(p.ld);
    const words = contentWords(p);
    const noAlt = p.imgs.filter((im) => !(im.alt || "").trim() && im.role !== "presentation").length;
    const robotsMeta = (p.meta.robots || "").toLowerCase();
    Object.assign(rec, {
      title: p.title, title_len: p.title.length, desc_len: desc.length, canonical: canon, h1_count: p.h1, words,
      imgs: p.imgs.length, imgs_no_alt: noAlt, jsonld: types, og_image: p.meta["og:image"] ? 1 : 0, noindex: robotsMeta.includes("noindex") ? 1 : 0,
    });
    if (robotsMeta.includes("noindex") && inSm) add("noindex_in_sitemap", url);
    if (!p.title) add("missing_title", url);
    else if (p.title.length < 25 || p.title.length > 65) add("title_length", url, `${p.title.length} کاراکتر`);
    if (!desc) add("missing_description", url);
    else if (desc.length < 70 || desc.length > 165) add("description_length", url, `${desc.length} کاراکتر`);
    if (!canon) add("missing_canonical", url);
    else if (U(canon) !== U(url) && U(canon) !== U(r.final)) add("canonical_elsewhere", url, decodeURIComponent(canon));
    if (p.h1 !== 1) add("h1_count", url, p.h1);
    if ((kind === "article" || kind === "product") && words < 300) add("thin_content", url, `${words} کلمه`);
    const need = kind === "product" ? "Product" : kind === "article" ? "Article" : kind === "home" ? "Organization" : null;
    if (bad) add("invalid_schema", url);
    if (need && !types.some((t) => t.includes(need) || (need === "Article" && ["BlogPosting", "NewsArticle"].includes(t)) || (need === "Organization" && (t.includes("Store") || t.includes("LocalBusiness"))))) {
      add("missing_schema", url, need);
    }
    if ((kind === "product" || kind === "article") && !types.includes("BreadcrumbList")) add("missing_breadcrumb", url);
    if (!p.meta["og:image"]) add("missing_og_image", url);
    if (noAlt) add("img_no_alt", url, `${noAlt} از ${p.imgs.length}`);
    if (r.ms > 3000) add("slow_page", url, `${(r.ms / 1000).toFixed(1)} ثانیه`);
    if (r.bytes > 300 * 1024) add("heavy_html", url, `${Math.floor(r.bytes / 1024)}KB`);
    if (p.title) { if (!titles.has(p.title)) titles.set(p.title, []); titles.get(p.title)!.push(url); }
    if (desc) { if (!descs.has(desc)) descs.set(desc, []); descs.get(desc)!.push(url); }

    const outs = new Set<string>();
    for (const h of p.a) {
      try {
        const full = new URL(h, r.final).href;
        const pu = new URL(full);
        if ((pu.protocol === "http:" || pu.protocol === "https:") && pu.host.replace(/^www\./, "") === host.replace(/^www\./, "")) outs.add(U(full));
      } catch { /* skip malformed hrefs */ }
    }
    rec.outlinks = outs.size;
    for (const o of outs) if (o !== U(url)) linksTo.set(o, (linksTo.get(o) || 0) + 1);
    for (const o of outs) internal.add(o);
  }

  for (const [t, us] of titles) if (us.length > 1) for (const u of us) add("duplicate_title", u, `${us.length} صفحه: ${t.slice(0, 60)}`);
  for (const [, us] of descs) if (us.length > 1) for (const u of us) add("duplicate_description", u, `${us.length} صفحه`);

  const crawled = new Set(pages.map((p) => p.url));
  const fullCrawl = !onlyOpen && pages.length >= 0.8 * Math.max(urls.length, 1);
  for (const p of pages) {
    p.inlinks = linksTo.get(p.url) || 0;
    if ((p.kind === "product" || p.kind === "article") && p.status === 200 && p.inlinks === 0 && !onlyOpen && fullCrawl) add("orphan_page", p.url);
  }
  const skip = /\/(cart|checkout|login|auth|dashboard|account|api|panel|wp-admin)\b|\.(jpg|jpeg|png|webp|svg|pdf|zip)$/i;
  const candidates = onlyOpen ? [] : [...internal].filter((u) => !crawled.has(u) && !skip.test(u) && !u.includes("?")).sort();
  for (const u of candidates.filter((u) => !sitemapSet.has(u) && ["product", "article"].includes(pageKind(u, base))).slice(0, 50)) add("not_in_sitemap", u);
  for (const u of candidates.slice(0, 60)) {
    progress({ message: `بررسی لینک: ${u}` });
    let r = await fetchUrl(u, "HEAD"); await sleep(DELAY_MS);
    if (r.status === 405 || r.status === 403) { r = await fetchUrl(u); await sleep(DELAY_MS); }
    if (r.status === 0) netErrors++;
    else if (r.status >= 400) add("broken_link", u, r.status);
  }

  for (const r of stillOpen) {
    if (!LINK_CODES.has(r.code) || (r.code === "not_in_sitemap" && sitemapSet.has(U(r.url)))) continue;
    let c = await fetchUrl(r.url, "HEAD"); await sleep(DELAY_MS);
    if (c.status === 405 || c.status === 403) { c = await fetchUrl(r.url); await sleep(DELAY_MS); }
    if (c.status === 0) netErrors++;
    if (c.status === 0 || (r.code === "broken_link") === (c.status >= 400)) add(r.code, r.url, r.code === "broken_link" ? c.status : "");
  }

  const perPage = new Map<string, number>();
  for (const [, u] of found) perPage.set(u, (perPage.get(u) || 0) + 1);
  for (const p of pages) p.issues = (perPage.get(p.url) || 0) + (perPage.get(p.url + "/") || 0);

  const summary: Record<string, unknown> = {
    sitemap_urls: urls.length, crawled: pages.length,
    by_kind: Object.fromEntries([...pages.reduce((m, p) => m.set(p.kind, (m.get(p.kind) || 0) + 1), new Map<string, number>())]),
    median_ms: pages.length ? [...pages].map((p) => p.ms).sort((a, b) => a - b)[Math.floor(pages.length / 2)] : 0,
    home_ms: home.ms, home_kb: Math.floor(home.bytes / 1024), network_errors: netErrors, full_crawl: fullCrawl,
  };
  return finish(found, pages, summary, logLines);
}

export function scoreOf(found: Found[], nPages: number): number {
  const n = Math.max(nPages, 1);
  const byCode = new Map<string, number>();
  for (const [c] of found) byCode.set(c, (byCode.get(c) || 0) + 1);
  const siteWide = new Set(["site_down", "no_sitemap", "robots_blocks_all", "no_https_redirect", "www_inconsistent", "sitemap_host_mismatch", "no_hsts", "no_compression", "no_robots", "sitemap_duplicates"]);
  const WEIGHT = { critical: 15, warning: 5, info: 1.5 };
  let penalty = 0;
  for (const [code, cnt] of byCode) {
    const sev = CHECKS[code][0];
    const frac = siteWide.has(code) ? 1 : Math.min(1, (cnt / n) * 2);
    penalty += WEIGHT[sev] * (0.35 + 0.65 * frac);
  }
  return Math.max(0, Math.round(100 - penalty));
}

function finish(found: Found[], pages: PageRecord[], summary: Record<string, unknown>, logLines: string[]): AuditResult {
  const sev = { critical: 0, warning: 0, info: 0 };
  for (const [c] of found) sev[CHECKS[c][0]]++;
  Object.assign(summary, { issues: found.length, critical: sev.critical, warning: sev.warning, info: sev.info });
  return { score: scoreOf(found, pages.length), found, pages, summary, log: logLines.slice(-50) };
}

export function saveAudit(projectId: string, runId: number, result: AuditResult): number {
  const now = dbNow();
  many(
    "INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    result.pages.map((p) => [
      runId, p.url, p.kind, p.status, p.ms, p.kb, p.title || "", p.title_len || 0, p.desc_len || 0,
      p.canonical || "", p.h1_count || 0, p.words || 0, p.imgs || 0, p.imgs_no_alt || 0,
      JSON.stringify(p.jsonld || []), p.og_image || 0, p.noindex || 0, p.inlinks || 0, p.outlinks || 0, p.issues || 0,
    ]),
  );
  const seen = new Set<string>();
  for (const [code, url, detail] of result.found) {
    const decoded = decodeURIComponent(url);
    const key = `${code}\u0000${decoded}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sev = CHECKS[code][0];
    run(
      `INSERT INTO issues(project_id,code,url,severity,detail,status,first_seen,last_seen) VALUES(?,?,?,?,?,'open',?,?)
       ON CONFLICT(project_id,code,url) DO UPDATE SET detail=excluded.detail, last_seen=excluded.last_seen,
       status=CASE WHEN issues.status='ignored' THEN 'ignored' ELSE 'open' END, fixed_at=NULL`,
      projectId, code, decoded, sev, detail, now, now,
    );
  }
  // An issue is fixed only if this audit really looked at it and it's gone; a page that wasn't reached proves nothing.
  const siteRead = !result.summary.error;
  const read = new Set(result.pages.filter((p) => p.status).map((p) => U(p.url)));
  const still = new Set([...seen].map((k) => { const [code, url] = k.split("\u0000"); return `${code}\u0000${U(url)}`; }));
  let fixed = 0;
  for (const r of q<{ id: number; code: string; url: string }>("SELECT id, code, url FROM issues WHERE project_id=? AND status='open'", projectId)) {
    if (MANAGED_CODES.has(r.code) || still.has(`${r.code}\u0000${U(r.url)}`)) continue;
    if (r.code === "orphan_page" && !result.summary.full_crawl) continue;
    const ok = (SITE_CODES.has(r.code) || LINK_CODES.has(r.code)) ? siteRead : read.has(U(r.url));
    if (ok) { run("UPDATE issues SET status='fixed', fixed_at=? WHERE id=?", now, r.id); fixed++; }
  }
  return fixed;
}
