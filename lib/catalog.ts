// Ported from hub/catalog.py — crawls products/articles from public pages only (works
// without the site's API), extracts structured data from schema.org JSON-LD, and builds
// deterministic SEO fix proposals. Nothing is written to any site: build_fixes()'s one
// adapter call (reading the brand list) is a GET, same as the rest of this module.
import { q, run, now as dbNow } from "./db";
import { fetchUrl, parsePage, pageKind, sitemapUrls, U, contentWords, type ParsedPage } from "./crawl";
import { client, canWrite } from "./adapters";
import type { ProjectRow } from "./projects";

const GENERIC_BRANDS = new Set(["", "متفرقه", "نامشخص", "بدون برند", "no brand", "none", "other", "generic", "-"]);
const STOP = new Set("و در به از که با را این برای یک تا است چه چطور های ها مدل مناسب راهنمای راهنما انتخاب خرید بهترین قیمت سری".split(" "));
const DELAY_MS = 1000;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export function tokens(s: string): Set<string> {
  return new Set((s || "").split(/[\s\-_،؛:؟?!+()«»|/"'.,]+/).map((w) => w.toLowerCase()).filter((w) => w.length > 2 && !STOP.has(w)));
}

type JsonLdProduct = { "@type"?: string | string[]; brand?: unknown; name?: string; description?: string; image?: unknown; offers?: unknown; itemCondition?: string; [k: string]: unknown };

function findProduct(blocks: string[]): JsonLdProduct | null {
  const out: JsonLdProduct[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (o && typeof o === "object") {
      const d = o as JsonLdProduct;
      const t = d["@type"];
      if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(d);
      for (const k of ["@graph", "mainEntity", "itemOffered"]) if (k in d) walk((d as Record<string, unknown>)[k]);
    }
  };
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* skip malformed block */ } }
  return out[0] || null;
}

export type CatalogItem = {
  url: string; kind: "product" | "article"; title: string; meta: string; words: number;
  name: string; brand: string; description: string; images: string[]; available: number | null;
  price: string; currency: string; condition: string; links: string[]; no_alt: string[]; page_images: string[];
  spec_brand?: string; [k: string]: unknown;
};

function extract(url: string, r: { body: string; final: string }, kind: "product" | "article"): CatalogItem {
  const p = parsePage(r.body);
  const prod = kind === "product" ? findProduct(p.ld) : null;
  let host = ""; try { host = new URL(r.final).host.replace(/^www\./, ""); } catch { /* malformed final URL */ }
  const links = new Set<string>();
  for (const a of p.a) {
    try {
      const full = new URL(a, r.final).href;
      if (new URL(full).host.replace(/^www\./, "") === host) links.add(U(full));
    } catch { /* skip malformed href */ }
  }
  const rec: CatalogItem = {
    url: U(url), kind, title: p.title, meta: (p.meta.description || "").trim(), words: contentWords(p),
    name: "", brand: "", description: "", images: [], available: null, price: "", currency: "", condition: "",
    links: [...links].sort(), no_alt: [], page_images: [],
  };
  const resolve = (src: string) => { try { return new URL(src, r.final).href; } catch { return src; } };
  const isChrome = (src: string) => /logo|icon|sprite|enamad|\.svg/i.test(src);
  const contentImgs = p.imgs.filter((i) => i.src && !isChrome(i.src)).map((i) => resolve(i.src!));
  rec.no_alt = p.imgs.filter((i) => i.src && !(i.alt || "").trim() && !isChrome(i.src)).map((i) => resolve(i.src!)).slice(0, 30);

  if (prod) {
    const b = prod.brand;
    rec.brand = String((typeof b === "object" && b ? (b as { name?: string }).name : b) || "").trim();
    rec.name = String(prod.name || "").trim();
    rec.description = String(prod.description || "").trim();
    const img = prod.image || [];
    const imgList = Array.isArray(img) ? img : [img];
    rec.images = imgList.map((x) => (typeof x === "string" ? x : (x as { url?: string })?.url || ""));
    let o = prod.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
    o = Array.isArray(o) ? o[0] : o;
    if (o && typeof o === "object") {
      if (typeof o.availability === "string") rec.available = o.availability.includes("InStock") ? 1 : 0;
      rec.price = String(o.price || o.lowPrice || "");
      rec.currency = String(o.priceCurrency || "");
    }
    const cond = String((o && typeof o === "object" ? o.itemCondition : "") || prod.itemCondition || "");
    rec.condition = cond.includes("NewCondition") ? "new" : cond.includes("UsedCondition") ? "used" : cond.includes("RefurbishedCondition") ? "refurbished" : "";
  } else {
    rec.name = p.title.split(/\s[|·\-–]\s/)[0].trim();
    rec.images = p.meta["og:image"] ? [resolve(p.meta["og:image"])] : [];
  }
  rec.page_images = contentImgs.slice(0, 12);
  return rec;
}

export async function runCatalog(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}) {
  const base = "https://" + project.domain;
  const rb = await fetchUrl(base + "/robots.txt"); await sleep(DELAY_MS);
  const fromRobots = rb.status === 200 ? [...rb.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const sm = project.sitemap || fromRobots[0] || base + "/sitemap.xml";
  const urls = (await sitemapUrls(sm, (m) => progress(0, 0, m))) || [];
  // Pages the audit found linked on the site but missing from the sitemap belong to the catalog too.
  urls.push(...q<{ url: string }>("SELECT url FROM issues WHERE project_id=? AND code='not_in_sitemap' AND status='open'", project.id).map((r) => r.url));
  urls.push(...q<{ slug: string }>("SELECT slug FROM site_articles WHERE project_id=? AND published=1", project.id).map((r) => `https://${project.domain}/blog/${encodeURIComponent(r.slug)}`));

  const targets: [string, "product" | "article"][] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const k = pageKind(u, base);
    if (k !== "product" && k !== "article") continue;
    const key = U(u);
    if (seen.has(key)) continue;
    seen.add(key); targets.push([u, k]);
  }
  const limit = Number(project.settings?.catalog_max) || 500;
  const capped = targets.length > limit;
  const capped_targets = targets.slice(0, limit);

  const now = dbNow();
  let ok = 0, failed = 0;
  for (let i = 0; i < capped_targets.length; i++) {
    const [url, kind] = capped_targets[i];
    progress(i, capped_targets.length, decodeURIComponent(url));
    const r = await fetchUrl(url); await sleep(DELAY_MS);
    if (r.status !== 200) { failed++; continue; }
    const rec = extract(url, r, kind);
    run("INSERT OR REPLACE INTO catalog(project_id,url,kind,data,last_seen) VALUES (?,?,?,?,?)", project.id, rec.url, kind, JSON.stringify(rec), now);
    ok++;
  }
  if (!capped && failed <= capped_targets.length * 0.1) {
    run("DELETE FROM catalog WHERE project_id=? AND last_seen<?", project.id, now);
  }
  const fixes = await buildFixes(project);
  return { found: capped_targets.length, ok, failed, capped, ...fixes };
}

export function catalogRows(pid: string, kind?: "product" | "article"): CatalogItem[] {
  const rows = kind
    ? q<{ data: string }>("SELECT data FROM catalog WHERE project_id=? AND kind=?", pid, kind)
    : q<{ data: string }>("SELECT data FROM catalog WHERE project_id=?", pid);
  return rows.map((r) => JSON.parse(r.data));
}

export function related(text: string, items: CatalogItem[], n = 3): CatalogItem[] {
  const t = tokens(text);
  const scored = items.map((i) => [overlap(t, tokens(`${i.name} ${i.url}`)), i] as const).sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n).filter(([s]) => s > 0).map(([, i]) => i);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0; for (const x of a) if (b.has(x)) n++; return n;
}

/** Unwraps Next.js image-proxy URLs and skips site chrome, so the suggestion is an actual photo address. */
export function realImage(urls: string[]): string {
  for (const u of urls) {
    let src = u;
    try {
      const parsed = new URL(u);
      if (u.includes("/_next/image") && parsed.searchParams.get("url")) src = decodeURIComponent(parsed.searchParams.get("url")!);
      if (src.startsWith("/")) src = new URL(src, u).href;
    } catch { /* keep raw */ }
    if (!/\/(og|icons?|brands?|banners?|assets|static)\/|placeholder|default/i.test(src)) return src;
  }
  return "";
}

const NOT_A_BRAND = /protector|film|glass|case$|rgb|^\d|redmi|iphone|galaxy|samsung galaxy/i;
const NOT_BRAND_WORDS = new Set(["case", "cover", "magnetic", "lens", "film", "glass", "silicone", "apple", "iphone", "samsung", "sumsung", "xiaomi", "huawei", "redmi", "stylish"]);
// `\b` is ASCII-only in JS (it never matches around Persian letters, unlike Python's re
// module, which treats \w/\b as Unicode-aware by default) — found by running shortenTitle()
// against a real title and comparing to Python's actual output: "مدل "/"رنگ " were supposed
// to be stripped from the middle of the string but silently weren't. (?<![\p{L}\p{N}])/
// (?![\p{L}\p{N}]) with the `u` flag is the Unicode-aware boundary substitute.
const TITLE_RULES: [RegExp, string][] = [
  [/\(?پارت\s*نامبر[^)]*\)?/, ""], [/\s*مناسب برای\s*/, " "], [/\s*مناسب\s+/, " "], [/(?<![\p{L}\p{N}])مدل\s+/u, ""],
  [/ظرفیت\s+/, ""], [/(?<![\p{L}\p{N}])رنگ\s+/u, ""], [/طول\s+/, ""], [/قاب محافظ/, "قاب"], [/\s+[–—-]\s+.*$/, ""],
];

/** Drops filler words only; never cuts into a model number. Returns '' when it can't fit without losing meaning. */
export function shortenTitle(name: string, limit: number): string {
  let t = (name || "").replace(/\s+/g, " ").trim();
  for (const [pat, rep] of TITLE_RULES) {
    if (t.length <= limit) break;
    t = t.replace(pat, rep).replace(/\s+/g, " ").trim();
  }
  return t.length >= 15 && t.length <= limit ? t : "";
}

type Cache = { api: ReturnType<typeof client> | null };

/** The brand the product's own specifications state, through the site's API when connected. */
async function brandFromSpecs(project: ProjectRow, r: CatalogItem, cache: Cache): Promise<string> {
  if ("spec_brand" in r) return r.spec_brand || "";
  let val = "";
  // Only Steve/WordPress expose product(); Custom doesn't. Python's version has the same
  // gap (an AttributeError there is caught the same way this catch is) rather than a
  // feature every adapter type supports.
  const productFn = (cache.api as unknown as { product?: (url: string) => Promise<Record<string, unknown>> }).product;
  if (cache.api && productFn) {
    try {
      const p = await productFn.call(cache.api, r.url);
      const specs = (p.specifications as { key?: string; value?: unknown }[]) || [];
      val = String(specs.find((x) => x.key === "brand")?.value || "").trim();
    } catch {
      return ""; // try again on the next pass
    }
  }
  r.spec_brand = val;
  run("UPDATE catalog SET data=? WHERE project_id=? AND url=?", JSON.stringify(r), project.id, r.url);
  return val;
}

/** [proposal, explanation]. Prefers what the product says about itself; never invents a brand. */
async function suggestBrand(project: ProjectRow, r: CatalogItem, known: string[], cache: Cache): Promise<[string, string]> {
  const norm = (x: string) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const spec = await brandFromSpecs(project, r, cache);
  const modelCode = spec && /^([A-Za-z]{1,3}[-+ ]?\d+[A-Za-z]?|[A-Z]{2}\+[A-Z]{2})$/.test(spec); // RL21, P47, AR+AF name the item, not a maker
  if (spec && !GENERIC_BRANDS.has(spec.toLowerCase()) && !NOT_A_BRAND.test(spec) && !NOT_BRAND_WORDS.has(norm(spec)) && !modelCode) {
    const hit = known.find((b) => norm(b) === norm(spec));
    return [hit || spec, hit ? "از مشخصات خود محصول؛ این برند در سایت هست." : "از مشخصات خود محصول؛ این برند هنوز در سایت نیست و باید اول ساخته شود."];
  }
  // Only the very start of the product's address counts, and words that describe the item or the phone aren't brands.
  let slug = r.url.split("/").pop() || "";
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  slug = slug.toLowerCase().replace(/-/g, " ") + " ";
  const hit = known.find((b) => norm(b).length >= 3 && !NOT_BRAND_WORDS.has(norm(b)) && slug.startsWith(b.toLowerCase().replace(/-/g, " ") + " "));
  if (hit) return [hit, "از نام و آدرس محصول حدس زده شده؛ لطفاً چک کنید."];
  const note = spec && !GENERIC_BRANDS.has(spec.toLowerCase()) ? `در مشخصات «${spec}» آمده که نام برند به نظر نمی‌رسد. ` : "";
  return ["", note + "برند از داده‌ها معلوم نشد. برند را وارد کنید، یا اگر واقعاً بدون برند است «فعلی درست است» را بزنید."];
}

export async function buildFixes(project: ProjectRow) {
  const pid = project.id;
  const allRows = catalogRows(pid);
  const prods = allRows.filter((r) => r.kind === "product");
  const arts = allRows.filter((r) => r.kind === "article");
  const brandCounts = new Map<string, number>();
  for (const r of prods) if (!GENERIC_BRANDS.has(r.brand.toLowerCase())) brandCounts.set(r.brand, (brandCounts.get(r.brand) || 0) + 1);

  const cache: Cache = { api: canWrite(pid, "brand") ? client(pid) : null };
  let known = [...brandCounts.keys()];
  if (cache.api) {
    try {
      const d = await cache.api.req("GET", "/brand/storefront?page_number=1&page_size=100", undefined, false);
      const list = (d.brands as { name?: string }[]) || [];
      known.push(...list.map((b) => (b.name || "").trim()).filter((n) => !GENERIC_BRANDS.has(n.toLowerCase())));
    } catch { /* brand list optional */ }
  }
  known = [...new Set(known)].sort((a, b) => b.length - a.length);

  const want = new Map<string, [severity: string, current: string, proposed: string, detail: string]>();
  const add = (url: string, typ: string, severity: string, current: string, proposed: string, detail = "") => want.set(`${url}\u0000${typ}`, [severity, current, proposed, detail]);

  for (const r of prods) {
    const u = r.url;
    if (GENERIC_BRANDS.has(r.brand.toLowerCase())) {
      const [guess, why] = await suggestBrand(project, r, known, cache);
      add(u, "brand", "warning", r.brand || "(خالی)", guess, why);
    }
    if (r.no_alt.length) add(u, "image_alt", "info", `${r.no_alt.length} عکس بدون alt`, r.name, JSON.stringify(r.no_alt.slice(0, 12)));
    if (r.title.length > 65) {
      const limit = Math.max(35, 65 - Math.max(0, r.title.length - (r.name || "").trim().length)); // what the site adds after the name counts too
      const short = shortenTitle(r.name, limit);
      add(u, "seo_title", "warning", r.title, short, `الان ${r.title.length} کاراکتر است و گوگل آن را می‌برد؛ حداکثر ${limit} کاراکتر. ` + (short ? "با حذف کلمات اضافه کوتاه شد." : "بدون حذف اطلاعات مهم کوتاه نشد؛ Claude بنویسد."));
    }
    if ((r.description || "").split(/\s+/).filter(Boolean).length < 40) {
      add(u, "description", "warning", (r.description || "").slice(0, 300), "", `فقط ${(r.description || "").split(/\s+/).filter(Boolean).length} کلمه دارد؛ حداقل ۴۰ کلمه لازم است.`);
    }
    if (r.images.length && r.images.every((i) => /\/og\/|default|placeholder/.test(i)) && r.page_images.length) {
      const real = realImage(r.page_images);
      add(u, "schema_image", "warning", r.images[0], real, real ? "اسکیمای Product عکس پیش‌فرض دارد؛ نیاز به اصلاح کد سایت." : "اسکیمای Product عکس پیش‌فرض دارد؛ عکس محصول در صفحه تشخیص داده نشد.");
    }
  }
  const productUrls = new Set(prods.map((r) => r.url));
  for (const r of arts) {
    const u = r.url;
    if (!(r.meta.length >= 120 && r.meta.length <= 160)) add(u, "meta_description", "warning", r.meta, "", `الان ${r.meta.length} کاراکتر است؛ باید ۱۲۰ تا ۱۶۰ باشد تا در نتایج کامل دیده شود.`);
    if (!r.links.some((l) => productUrls.has(l)) && prods.length) {
      const rel = related(r.name, prods);
      if (rel.length) add(u, "internal_link", "info", "بدون لینک به محصول", rel.map((x) => `${x.name} — ${x.url}`).join("\n"), "محصولات از روی شباهت عنوان پیشنهاد شده‌اند؛ مرتبط بودن را چک کنید.");
    }
  }

  const now = dbNow();
  const existing = new Map(q<{ id: number; url: string; type: string; status: string }>("SELECT * FROM fixes WHERE project_id=?", pid).map((r) => [`${r.url}\u0000${r.type}`, r]));
  let newCount = 0, resolved = 0;
  for (const [key, [sev, cur, prop, detail]] of want) {
    const e = existing.get(key);
    const [url, typ] = key.split("\u0000");
    if (!e) {
      run("INSERT INTO fixes(project_id,url,type,severity,current,proposed,detail,status,created,updated) VALUES (?,?,?,?,?,?,?,'pending',?,?)", pid, url, typ, sev, cur, prop, detail, now, now);
      newCount++;
    } else {
      // Keep a proposal someone wrote or reviewed; refresh only what was read from the site.
      run(
        "UPDATE fixes SET current=?, detail=?, proposed=CASE WHEN proposed='' THEN ? ELSE proposed END, status=CASE WHEN status='resolved' THEN 'pending' ELSE status END, updated=? WHERE id=?",
        cur, detail, prop, now, e.id,
      );
    }
  }
  for (const [key, e] of existing) {
    if (!want.has(key) && (e.status === "pending" || e.status === "approved") && !e.type.startsWith("kw_") && e.type !== "cro_description" && e.type !== "oos_links") {
      run("UPDATE fixes SET status='resolved', updated=? WHERE id=?", now, e.id); resolved++;
    }
  }
  return { products: prods.length, articles: arts.length, fixes_total: want.size, fixes_new: newCount, fixes_resolved: resolved };
}
