// Ported from hub/adapters.py. Writes approved changes onto a project's own site — the one
// module in this rewrite that reaches a real, live site. Every apply() call here is wired
// and type-checked, but actual *write* calls (not the read-only product()/article()/test()
// paths) are deliberately NOT exercised against the real stevemobile.com during porting —
// that would modify live, customer-facing content. They should be verified with the
// project's own explicit go-ahead on a specific fix, the same "admin approval" gate the
// Python original already requires before anything reaches apply_fixes().
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, one, run } from "./db";
import type { ProjectRow } from "./projects";

export const WRITABLE: Record<string, readonly string[]> = {
  steve: ["seo_title", "description", "meta_description", "brand", "image_alt", "internal_link", "kw_title", "kw_description", "kw_refresh", "kw_faq", "cro_description", "oos_links"],
  wordpress: ["seo_title", "meta_description", "description", "kw_title", "kw_description", "cro_description", "oos_links"],
  custom: ["seo_title", "meta_description", "description", "kw_title", "kw_description", "cro_description", "oos_links"],
};

export type AdapterConfig = { type: "steve" | "wordpress" | "custom"; base_url: string; token: string };

function configPath(pid: string): string {
  return path.join(DATA_DIR, "keys", `adapter_${pid}.json`);
}

export function config(pid: string): AdapterConfig | null {
  const f = configPath(pid);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export function publicConfig(pid: string) {
  const c = config(pid);
  return c ? { type: c.type, base_url: c.base_url, writable: WRITABLE[c.type] || [] } : null;
}

export function saveConfig(pid: string, kind: string, baseUrl: string, token: string) {
  if (!(kind in WRITABLE)) throw new Error("نوع اتصال پشتیبانی نمی‌شود");
  const url = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) throw new Error("آدرس API باید با http شروع شود");
  const cur = config(pid);
  const tok = String(token || "").trim() || cur?.token;
  if (!tok) throw new Error("توکن لازم است");
  const f = configPath(pid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ type: kind, base_url: url, token: tok }), { mode: 0o600 });
}

export function canWrite(pid: string, fixType: string): boolean {
  const c = config(pid);
  return c ? (WRITABLE[c.type] || []).includes(fixType) : false;
}

export function removeConfig(pid: string) {
  const f = configPath(pid);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/** The site's own message, readable in the panel; unknown shapes are shown as they came. */
function apiError(code: number, raw: string): string {
  try {
    const d = JSON.parse(raw);
    const fields = Object.keys(d.errors || {});
    return `سایت نپذیرفت (${code}): ${d.message || ""}` + (fields.length ? ` [${fields.join(", ")}]` : "");
  } catch {
    return `API ${code}: ${raw.slice(0, 200)}`;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export type ApplyFix = { id: number; type: string; url: string; proposed: string; base_hash?: string };
export type UndoRecord = { kind: string; id?: string; url?: string; field?: string; before: Record<string, unknown> };

// Loosely typed on purpose: this one shape stands in for whatever JSON each site's API
// returns (products/articles/brands/meta all come back nested differently per adapter).
export type ApiData = Record<string, unknown> & {
  product?: Record<string, unknown>; article?: Record<string, unknown>; brands?: unknown[]; meta?: Record<string, string>; errors?: unknown;
};

export interface SiteAdapter {
  test(): Promise<boolean>;
  apply(fix: ApplyFix): Promise<UndoRecord>;
  undo(rec: UndoRecord): Promise<void>;
  sales?(start: string, end: string): Promise<{ url: string; name: string; units: number }[]>;
  req(method: string, p: string, body?: unknown, auth?: boolean): Promise<ApiData>;
}

/** Contracts from steve/api: PATCH /product/:id, PATCH /product/set-gallery-alt, PATCH /article/:id, POST /article/create. */
export class Steve implements SiteAdapter {
  base: string; token: string;
  constructor(cfg: AdapterConfig) { this.base = cfg.base_url; this.token = cfg.token; }

  async req(method: string, p: string, body?: unknown, auth = true): Promise<ApiData> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Accept-Language": "fa" };
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    const attempts = method === "GET" || method === "PATCH" ? 3 : 1; // these two are safe to repeat; a repeated POST could create a duplicate
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await sleep(3000 * attempt);
      try {
        const res = await fetch(this.base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
        if (!res.ok) throw new HttpStatusError(res.status, await res.text());
        const d = await res.json();
        return (d.data ?? d) as ApiData;
      } catch (e) {
        if (e instanceof HttpStatusError) throw new Error(apiError(e.status, e.body));
        lastErr = e;
      }
    }
    throw new Error(`سایت پاسخ نداد؛ دوباره تلاش کنید (${String((lastErr as Error)?.message || lastErr).slice(0, 80)})`);
  }

  async test() { await this.req("GET", "/product?page_number=1&page_size=1"); return true; }

  static slug(url: string): string {
    let path = url.replace(/\/+$/, "");
    path = path.split("/").pop() || "";
    try { path = decodeURIComponent(path); } catch { /* keep raw */ }
    return encodeURIComponent(path);
  }

  async product(url: string) {
    const d = await this.req("GET", `/product/storefront/get-by-slug/${Steve.slug(url)}`, undefined, false);
    return (d.product ?? d) as Record<string, unknown>;
  }

  async article(url: string) {
    const d = await this.req("GET", `/article/storefront/get-by-slug/${Steve.slug(url)}`, undefined, false);
    return (d.article ?? d) as Record<string, unknown>;
  }

  async brandId(name: string): Promise<string> {
    const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, "");
    for (let page = 1; page < 30; page++) {
      const d = await this.req("GET", `/brand/storefront?page_number=${page}&page_size=100`, undefined, false);
      const brands = (d.brands as { name?: string; id?: string; _id?: string }[]) || [];
      for (const b of brands) if (norm(b.name || "") === norm(name)) return (b.id || b._id) as string;
      if (brands.length < 100) break;
    }
    throw new Error(`برند «${name}» در سایت نیست؛ اول در بک‌آفیس بسازید`);
  }

  async apply(fix: ApplyFix): Promise<UndoRecord> {
    const { type: t, url, proposed: val } = fix;
    if (t === "seo_title" || t === "description" || t === "brand" || t === "cro_description" || t === "oos_links" || (t.startsWith("kw_") && url.includes("/product/"))) {
      const p = await this.product(url);
      const pid = (p._id || p.id) as string;
      const curRes = await this.req("GET", `/product/${pid}`);
      const curProduct = (curRes.product ?? curRes) as Record<string, unknown>;
      const secondHand = curProduct.is_second_hand;
      if (typeof secondHand !== "boolean") throw new Error("وضعیت کارکرده بودن محصول از سایت خوانده نشد؛ چیزی تغییر نکرد");
      let body: Record<string, unknown>, before: Record<string, unknown>;
      if (t === "kw_faq") {
        if (curProduct.faq) throw new Error("این محصول همین حالا پرسش‌های متداول دارد؛ چیزی جایگزین نشد");
        body = { faq: JSON.parse(val) }; before = { faq: [] };
      } else if (t.startsWith("kw_")) {
        const field = t === "kw_title" ? "seo_title" : "seo_description";
        body = { [field]: val }; before = { [field]: curProduct[field] || "" };
      } else if (t === "seo_title") {
        body = { seo_title: val }; before = { seo_title: p.seo_title || "" };
      } else if (t === "cro_description" || t === "oos_links") {
        if (crypto.createHash("sha256").update(String(p.description || "")).digest("hex") !== fix.base_hash) throw new Error("توضیح محصول بعد از آماده شدن پیشنهاد عوض شده؛ دوباره پیشنهاد بگیرید");
        body = { description: val }; before = { description: p.description || "" };
      } else if (t === "description") {
        body = { description: val }; before = { description: p.description || "" };
      } else {
        const brandId = await this.brandId(val);
        body = { brand_id: brandId }; before = { brand_id: (p.brand as { id?: string } | undefined)?.id };
      }
      before.is_second_hand = secondHand;
      await this.req("PATCH", `/product/${pid}`, { ...body, is_second_hand: secondHand });
      return { kind: "product", id: pid, before };
    }
    if (t === "kw_refresh") {
      const a = await this.article(decodeURIComponent(url));
      const aid = (a.id || a._id) as string;
      const fullRes = await this.req("GET", `/article/${aid}`);
      const full = (fullRes.article ?? fullRes) as Record<string, unknown>;
      if (crypto.createHash("sha256").update(String(full.body || "")).digest("hex") !== fix.base_hash) throw new Error("مقاله بعد از آماده شدن بازنویسی عوض شده؛ دوباره پیشنهاد بگیرید");
      await this.req("PATCH", `/article/${aid}`, { body: val });
      return { kind: "article", id: aid, before: { body: full.body || "" } };
    }
    if (t.startsWith("kw_")) {
      const a = await this.article(url);
      const aid = (a.id || a._id) as string;
      const field = t === "kw_title" ? "title" : "meta_description";
      await this.req("PATCH", `/article/${aid}`, { [field]: val });
      return { kind: "article", id: aid, before: { [field]: a[field] || "" } };
    }
    if (t === "meta_description") {
      const a = await this.article(url);
      const aid = (a.id || a._id) as string;
      await this.req("PATCH", `/article/${aid}`, { meta_description: val });
      return { kind: "article", id: aid, before: { meta_description: a.meta_description || "" } };
    }
    if (t === "internal_link") {
      const a = await this.article(url);
      const aid = (a.id || a._id) as string;
      const fullRes = await this.req("GET", `/article/${aid}`);
      const full = (fullRes.article ?? fullRes) as Record<string, unknown>;
      if (!val.trimStart().startsWith("<")) throw new Error("متن لینک‌دار آماده نیست");
      if (crypto.createHash("sha256").update(String(full.body || "")).digest("hex") !== fix.base_hash) throw new Error("مقاله بعد از آماده شدن لینک‌ها عوض شده؛ دوباره رفع خودکار بزنید");
      await this.req("PATCH", `/article/${aid}`, { body: val });
      return { kind: "article", id: aid, before: { body: full.body || "" } };
    }
    if (t === "image_alt") {
      const p = await this.product(url);
      const pid = (p._id || p.id) as string;
      const changed: string[] = [];
      const gallery = (p.gallery as { alt?: string; media_id: string }[]) || [];
      for (let i = 0; i < gallery.length; i++) {
        const g = gallery[i];
        if ((g.alt || "").trim()) continue; // never overwrite an alt someone wrote
        await this.req("PATCH", "/product/set-gallery-alt", { media_id: g.media_id, product_id: pid, alt: i === 0 ? val : `${val} - تصویر ${i + 1}` });
        changed.push(g.media_id);
      }
      return { kind: "gallery", id: pid, before: { media: changed } };
    }
    throw new Error("این نوع اصلاح قابل ثبت خودکار نیست");
  }

  async undo(rec: UndoRecord) {
    const b = rec.before;
    if (rec.kind === "product") {
      if ("brand_id" in b && !b.brand_id) throw new Error("این محصول قبلاً برند نداشت و سایت اجازه خالی کردن برند را نمی‌دهد؛ از بک‌آفیس اصلاح کنید");
      await this.req("PATCH", `/product/${rec.id}`, b);
    } else if (rec.kind === "article") {
      await this.req("PATCH", `/article/${rec.id}`, b);
    } else if (rec.kind === "gallery") {
      for (const m of b.media as string[]) await this.req("PATCH", "/product/set-gallery-alt", { media_id: m, product_id: rec.id, alt: "" });
    }
  }

  async uploadImage(filePath: string): Promise<string> {
    const boundary = crypto.randomUUID().replace(/-/g, "");
    const file = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext] || "image/png";
    const parts: Buffer[] = [];
    const field = (name: string, value: string) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    parts.push(field("domain", "article"), field("is_public", "true"), field("convert_to_webp", "true"));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
    const res = await fetch(this.base + "/media/upload", { method: "POST", body: Buffer.concat(parts), headers: { Authorization: `Bearer ${this.token}`, "Content-Type": `multipart/form-data; boundary=${boundary}` }, cache: "no-store" });
    if (!res.ok) throw new Error(apiError(res.status, await res.text()));
    const d = await res.json();
    return (d.data ?? d).id;
  }

  async createDraft(output: { title: string; slug: string; body_html: string; tags?: string[]; meta_description?: string; image_alt?: string }, mediaId: string) {
    const body = {
      title: output.title, slug: output.slug, body: output.body_html, tags: output.tags || [],
      meta_description: output.meta_description || "", alt: output.image_alt || output.title, media_id: mediaId,
      is_published: false, // drafts only: publishing stays a human decision in the back office
    };
    const d = await this.req("POST", "/article/create", body);
    return d.article ?? d;
  }
}

class HttpStatusError extends Error {
  status: number; body: string;
  constructor(status: number, body: string) { super(`HTTP ${status}`); this.status = status; this.body = body; }
}

/** WordPress REST with an Application Password; token is "user:password". SEO fields need deploy/growth-hub-seo.php on the site. */
export class WordPress implements SiteAdapter {
  base: string; auth: string;
  static SEO: Record<string, [string, string]> = {
    kw_title: ["rank_math_title", "_yoast_wpseo_title"], seo_title: ["rank_math_title", "_yoast_wpseo_title"],
    kw_description: ["rank_math_description", "_yoast_wpseo_metadesc"], meta_description: ["rank_math_description", "_yoast_wpseo_metadesc"],
  };

  constructor(cfg: AdapterConfig) { this.base = cfg.base_url; this.auth = Buffer.from(cfg.token).toString("base64"); }

  async req(method: string, p: string, body?: unknown): Promise<ApiData> {
    const res = await fetch(this.base + p, { method, headers: { "Content-Type": "application/json", Authorization: `Basic ${this.auth}` }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!res.ok) throw new Error(apiError(res.status, await res.text()));
    return res.json();
  }

  async test() { await this.req("GET", "/wp-json/wp/v2/users/me?context=edit"); return true; }

  async find(url: string): Promise<[string, Record<string, unknown> & { id: number; title?: { raw?: string }; content?: { raw?: string }; meta?: Record<string, string> }]> {
    let slug = url.replace(/\/+$/, "").split("/").pop() || "";
    try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
    slug = encodeURIComponent(slug);
    const kinds = url.includes("/product/") ? ["product", "posts", "pages"] : ["posts", "pages", "product"];
    for (const kind of kinds) {
      let found: unknown[];
      try { found = await this.req("GET", `/wp-json/wp/v2/${kind}?slug=${slug}&context=edit&status=any`) as unknown as unknown[]; }
      catch { continue; }
      if (found.length) return [kind, found[0] as (typeof found)[0] & { id: number; title?: { raw?: string }; content?: { raw?: string }; meta?: Record<string, string> }];
    }
    throw new Error("این صفحه در وردپرس پیدا نشد");
  }

  async product(url: string) {
    const [, p] = await this.find(url);
    return { name: p.title?.raw, description: p.content?.raw || "", brand: {} };
  }

  private seoKey(post: { meta?: Record<string, string> }, t: string): string {
    const keys = WordPress.SEO[t];
    const anyKey = keys.find((k) => k in (post.meta || {}));
    if (!anyKey) throw new Error("فیلد سئو در دسترس نیست؛ افزونه growth-hub-seo را روی وردپرس نصب کنید");
    return keys.find((k) => (post.meta?.[k] || "").trim()) || anyKey; // whichever plugin's field already has a value is the one in use
  }

  async apply(fix: ApplyFix): Promise<UndoRecord> {
    const { type: t, proposed: val } = fix;
    const [kind, post] = await this.find(fix.url);
    let before: Record<string, unknown>;
    if (t in WordPress.SEO) {
      const key = this.seoKey(post, t);
      before = { meta: { [key]: post.meta?.[key] || "" } };
      await this.req("POST", `/wp-json/wp/v2/${kind}/${post.id}`, { meta: { [key]: val } });
      const check = await this.req("GET", `/wp-json/wp/v2/${kind}/${post.id}?context=edit`) as { meta?: Record<string, string> };
      if ((check.meta || {})[key] !== val) throw new Error("وردپرس فیلد سئو را ذخیره نکرد");
    } else if (t === "description" || t === "cro_description" || t === "oos_links") {
      const cur = post.content?.raw || "";
      if ((t === "cro_description" || t === "oos_links") && crypto.createHash("sha256").update(cur).digest("hex") !== fix.base_hash) throw new Error("توضیح صفحه بعد از آماده شدن پیشنهاد عوض شده؛ دوباره پیشنهاد بگیرید");
      before = { content: cur };
      await this.req("POST", `/wp-json/wp/v2/${kind}/${post.id}`, { content: val });
    } else {
      throw new Error("این نوع اصلاح قابل ثبت خودکار نیست");
    }
    return { kind, id: String(post.id), before };
  }

  async undo(rec: UndoRecord) {
    await this.req("POST", `/wp-json/wp/v2/${rec.kind}/${rec.id}`, rec.before);
  }

  async sales(start: string, end: string) {
    const rows = await this.req("GET", `/wp-json/wc-analytics/reports/products?after=${start}T00:00:00&before=${end}T23:59:59&per_page=100&extended_info=true`) as unknown as { extended_info?: { permalink?: string; name?: string }; items_sold?: number }[];
    return rows.filter((r) => r.extended_info?.permalink).map((r) => ({ url: r.extended_info!.permalink!, name: r.extended_info!.name || "", units: Number(r.items_sold || 0) }));
  }
}

/** A hand-built site that implements docs/custom-site-api.md. */
export class Custom implements SiteAdapter {
  base: string; token: string;
  static FIELD: Record<string, string> = { kw_title: "seo_title", seo_title: "seo_title", kw_description: "seo_description", meta_description: "seo_description", description: "description", cro_description: "description", oos_links: "description" };

  constructor(cfg: AdapterConfig) { this.base = cfg.base_url; this.token = cfg.token; }

  async req(method: string, p: string, body?: unknown): Promise<ApiData> {
    const res = await fetch(this.base + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!res.ok) throw new Error(apiError(res.status, await res.text()));
    return res.json();
  }

  async test() { await this.req("GET", "/ping"); return true; }

  async apply(fix: ApplyFix): Promise<UndoRecord> {
    if (!(fix.type in Custom.FIELD)) throw new Error("این نوع اصلاح قابل ثبت خودکار نیست");
    const field = Custom.FIELD[fix.type];
    const d = await this.req("POST", "/apply", { url: fix.url, field, value: fix.proposed }) as { previous?: unknown };
    if (!("previous" in d)) throw new Error("سایت مقدار قبلی را نداد؛ تغییر قابل برگشت نیست");
    return { kind: "custom", url: fix.url, field, before: { value: d.previous } };
  }

  async undo(rec: UndoRecord) {
    await this.req("POST", "/apply", { url: rec.url, field: rec.field, value: rec.before.value });
  }

  async sales(start: string, end: string) {
    const d = await this.req("GET", `/sales?from=${start}&to=${end}`) as { products?: { url: string; name: string; units: number }[] };
    return d.products || [];
  }
}

export function client(pid: string): SiteAdapter {
  const c = config(pid);
  if (!c) throw new Error("این پروژه به API سایت وصل نیست");
  const Cls = { steve: Steve, wordpress: WordPress, custom: Custom }[c.type];
  return new Cls(c);
}

/** {page path: units} from the site's own report, or null when this site can't say. */
export async function sales(project: ProjectRow, start: string, end: string): Promise<Record<string, number> | null> {
  const c = config(project.id);
  if (!c) return null;
  const api = client(project.id);
  let rows: { url: string; name: string; units: number }[];
  try {
    if (c.type === "steve") {
      const d = await api.req("GET", `/backoffice/dashboard/ai-summary?from=${start}&to=${end}&page_number=1&page_size=1`) as { top_products?: { slug?: string; name: string; units_sold?: number }[] };
      rows = (d.top_products || []).filter((r) => r.slug && r.units_sold).map((r) => ({ url: `https://${project.domain}/product/${r.slug}`, name: r.name, units: Number(r.units_sold) }));
    } else {
      rows = (await api.sales?.(start, end)) || [];
    }
  } catch {
    return null;
  }
  const out: Record<string, number> = {};
  for (const r of rows) {
    try { out[new URL(r.url).pathname.replace(/\/$/, "") || "/"] = r.units; } catch { /* skip malformed URL */ }
  }
  return out;
}

type FixRow = { id: number; project_id: string; status: string; type: string; proposed: string; url: string };

export async function applyFixes(project: ProjectRow, ids: number[], user: string, progress: (done: number, total: number, message: string) => void = () => {}) {
  const pid = project.id;
  const api = client(pid);
  const c = config(pid)!;
  const writable = WRITABLE[c.type];
  let ok = 0, failed = 0, skipped = 0;
  for (let n = 0; n < ids.length; n++) {
    const fid = ids[n];
    const f = one<FixRow>("SELECT * FROM fixes WHERE id=? AND project_id=?", fid, pid);
    progress(n, ids.length, f ? decodeURIComponent(f.url) : "");
    if (!f || f.status !== "approved" || !writable.includes(f.type) || !f.proposed) { skipped++; continue; }
    try {
      const rec = await api.apply(f);
      const afterLabel = f.type === "internal_link" ? "لینک به محصول در متن مقاله اضافه شد"
        : f.type === "kw_refresh" ? "متن مقاله بازنویسی شد"
        : f.type === "kw_faq" ? "پرسش‌های متداول اضافه شد"
        : f.type === "cro_description" ? "توضیح محصول بازنویسی شد"
        : f.proposed;
      run(
        "INSERT INTO applied(project_id,fix_id,url,type,before,after,ts,user_name) VALUES (?,?,?,?,?,?,?,?)",
        pid, fid, f.url, f.type, JSON.stringify(rec), afterLabel, Date.now() / 1000, user,
      );
      run("UPDATE fixes SET status='done', apply_error='', updated=? WHERE id=?", Date.now() / 1000, fid);
      ok++;
    } catch (e) {
      run("UPDATE fixes SET apply_error=?, updated=? WHERE id=?", String((e as Error).message || e).slice(0, 300), Date.now() / 1000, fid);
      failed++;
    }
    await sleep(1000);
  }
  return { applied: ok, failed, skipped };
}

export async function undoApplied(appliedId: number) {
  const a = one<{ id: number; project_id: string; before: string; undone: number; type: string; fix_id: number; url: string }>("SELECT * FROM applied WHERE id=?", appliedId);
  if (!a || a.undone) throw new Error("این تغییر قابل برگشت نیست");
  await client(a.project_id).undo(JSON.parse(a.before));
  run("UPDATE applied SET undone=1 WHERE id=?", appliedId);
  if (a.type === "publish") {
    run(
      "UPDATE content SET status='drafted', updated=? WHERE project_id=? AND status='published' AND json_extract(output,'$.published_url')=?",
      Date.now() / 1000, a.project_id, a.url,
    );
  }
  run("UPDATE fixes SET status='approved', updated=? WHERE id=?", Date.now() / 1000, a.fix_id);
}
