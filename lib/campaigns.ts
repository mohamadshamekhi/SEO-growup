// New feature, no Python reference to port — covers 3 campaign types in one table
// (seasonal/discount, content-goal, paid-ads) since they share name/status/date/note shape
// and only differ in a few optional fields. Metrics/budget/spend are manual entries only;
// no ads API is connected.
import { now, one, q, run } from "./db";
import { askAI, parseJsonLoose, AIGatewayError } from "./ai";
import { catalogRows } from "./catalog";
import { digest, demand } from "./opps";
import { jalaliYmd } from "./intl/jalali";
import type { ProjectRow } from "./projects";

export type CampaignType = "seasonal" | "content" | "paid";
export type CampaignStatus = "planned" | "active" | "paused" | "done" | "archived";

export type CampaignRow = {
  id: number; project_id: string; name: string; type: CampaignType; status: CampaignStatus;
  goal: string; channel: string; start_date: string; end_date: string;
  budget: number | null; spend: number | null; discount_percent: number | null; discount_note: string;
  content_ids: number[]; idea_ids: number[]; product_urls: string[];
  metrics: Record<string, number | string>; note: string; created_by: string | null; created: number; updated: number;
};

type RawCampaignRow = Omit<CampaignRow, "content_ids" | "idea_ids" | "product_urls" | "metrics"> & {
  content_ids: string; idea_ids: string; product_urls: string; metrics: string;
};

function decode(r: RawCampaignRow): CampaignRow {
  return {
    ...r,
    content_ids: JSON.parse(r.content_ids || "[]"),
    idea_ids: JSON.parse(r.idea_ids || "[]"),
    product_urls: JSON.parse(r.product_urls || "[]"),
    metrics: JSON.parse(r.metrics || "{}"),
  };
}

export const TYPES: Record<CampaignType, string> = { seasonal: "فصلی/تخفیفی", content: "محتوایی", paid: "تبلیغاتی پولی" };
export const STATUSES: Record<CampaignStatus, string> = { planned: "برنامه‌ریزی‌شده", active: "فعال", paused: "متوقف", done: "پایان‌یافته", archived: "آرشیو" };
export const DATE_RE = /^\d{4}\/\d{2}\/\d{2}$/;

export function get(id: number): CampaignRow | undefined {
  const r = one<RawCampaignRow>("SELECT * FROM campaigns WHERE id=?", id);
  return r ? decode(r) : undefined;
}

export function listing(pid: string, type?: CampaignType): CampaignRow[] {
  const rows = type
    ? q<RawCampaignRow>("SELECT * FROM campaigns WHERE project_id=? AND type=? ORDER BY start_date='' , start_date DESC, id DESC LIMIT 300", pid, type)
    : q<RawCampaignRow>("SELECT * FROM campaigns WHERE project_id=? ORDER BY start_date='', start_date DESC, id DESC LIMIT 300", pid);
  return rows.map(decode);
}

export type CampaignInput = {
  name: string; type: CampaignType; status?: CampaignStatus; goal?: string; channel?: string;
  start_date?: string; end_date?: string; budget?: number | null; spend?: number | null;
  discount_percent?: number | null; discount_note?: string; content_ids?: number[]; idea_ids?: number[];
  product_urls?: string[]; metrics?: Record<string, number | string>; note?: string;
};

export function create(pid: string, createdBy: string, body: CampaignInput): number {
  const info = run(
    `INSERT INTO campaigns(project_id,name,type,status,goal,channel,start_date,end_date,budget,spend,
      discount_percent,discount_note,content_ids,idea_ids,product_urls,metrics,note,created_by,created,updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, body.name, body.type, body.status || "planned", body.goal || "", body.channel || "",
    body.start_date || "", body.end_date || "", body.budget ?? null, body.spend ?? null,
    body.discount_percent ?? null, body.discount_note || "", JSON.stringify(body.content_ids || []),
    JSON.stringify(body.idea_ids || []), JSON.stringify(body.product_urls || []),
    JSON.stringify(body.metrics || {}), body.note || "", createdBy, now(), now(),
  );
  return Number(info.lastInsertRowid);
}

export function update(id: number, body: Partial<CampaignInput>): void {
  const c = get(id);
  if (!c) throw new Error("not found");
  const next = { ...c, ...body };
  run(
    `UPDATE campaigns SET name=?, type=?, status=?, goal=?, channel=?, start_date=?, end_date=?, budget=?, spend=?,
      discount_percent=?, discount_note=?, content_ids=?, idea_ids=?, product_urls=?, metrics=?, note=?, updated=?
     WHERE id=?`,
    next.name, next.type, next.status, next.goal, next.channel, next.start_date, next.end_date,
    next.budget ?? null, next.spend ?? null, next.discount_percent ?? null, next.discount_note,
    JSON.stringify(next.content_ids || []), JSON.stringify(next.idea_ids || []), JSON.stringify(next.product_urls || []),
    JSON.stringify(next.metrics || {}), next.note, now(), id,
  );
}

export function remove(id: number): void {
  run("DELETE FROM campaign_plans WHERE campaign_id=?", id);
  run("DELETE FROM campaigns WHERE id=?", id);
}

/** The "ساخت خودکار" button: a title (or nothing at all) goes in, a full draft campaign
 * comes out — AI picks type/goal/channel/dates/products from real site data (catalog,
 * opps.digest, unmet-demand searches), never fabricated numbers. Always lands as status
 * 'planned'; nothing here writes to the live site — a human still reviews/edits/activates it. */
export async function autoGenerate(project: ProjectRow, createdBy: string, title?: string): Promise<number> {
  const pid = project.id;
  const todayJalali = jalaliYmd(Date.now());
  const products = catalogRows(pid, "product").filter((p) => p.title).slice(0, 40).map((p) => ({ name: p.title, url: p.url }));
  const existing = q<{ name: string; type: CampaignType; status: CampaignStatus; start_date: string; end_date: string }>(
    "SELECT name, type, status, start_date, end_date FROM campaigns WHERE project_id=? AND status IN ('planned','active') ORDER BY id DESC LIMIT 20",
    pid,
  );
  let actions: string[] = [];
  let demandTopics: string[] = [];
  try {
    actions = digest(project).actions;
    demandTopics = demand(project).slice(0, 10).map((d) => d.query);
  } catch { /* opps needs GSC/catalog data that may not be ready yet; campaign can still draft without it */ }

  const prompt = [
    "یک کمپین واحد (فصلی/تخفیفی یا محتوایی یا تبلیغاتی پولی) برای فروشگاه موبایل و لوازم جانبی پیشنهاد بده. فقط JSON برگردان، بدون توضیح اضافه.",
    "قوانین: فقط از داده‌های همین پیام استفاده کن؛ قیمت، درصد تخفیف قطعی، موجودی یا آماری که اینجا نیامده نساز — discount_percent و budget را فقط به‌عنوان پیشنهاد اولیه (قابل ویرایش توسط انسان) بده، نه ادعای قطعی. product_urls را فقط از لیست محصولات واقعی زیر انتخاب کن.",
    title ? `عنوان درخواستی کاربر (حتماً همین را برای name استفاده کن، بقیه را خودت بساز): ${title}` : "کاربر عنوانی نداده؛ بهترین فرصت را از داده‌ها پیدا کن و name مناسب بساز.",
    `تاریخ امروز (شمسی): ${todayJalali}`,
    actions.length ? `وضعیت فعلی سایت: ${actions.join(" | ")}` : "",
    demandTopics.length ? `جستجوهایی که مشتری دنبال می‌کند ولی صفحه خوبی برایش نیست: ${demandTopics.join("، ")}` : "",
    existing.length ? `کمپین‌های فعال/برنامه‌ریزی‌شده فعلی (تاریخ تداخل نداشته باشد): ${existing.map((e) => `${e.name} (${e.start_date}..${e.end_date})`).join("، ")}` : "کمپین فعال دیگری نیست.",
    `محصولات واقعی سایت (فقط از همین‌ها انتخاب کن): ${JSON.stringify(products).slice(0, 4000)}`,
    "فرمت خروجی دقیقاً: {\"name\":\"...\",\"type\":\"seasonal|content|paid\",\"goal\":\"...\",\"channel\":\"...\",\"start_date\":\"۱۴۰۵/۰۸/۳۰ به شکل لاتین مثل 1405/08/30\",\"end_date\":\"...\",\"discount_percent\":عدد یا null,\"discount_note\":\"...\",\"product_urls\":[\"...\"],\"note\":\"توضیح کوتاه چرا این کمپین الان\"}",
  ].filter(Boolean).join("\n\n");

  let parsed: Record<string, unknown>;
  try {
    const raw = await askAI(prompt);
    parsed = parseJsonLoose(raw);
  } catch (e) {
    throw e instanceof AIGatewayError ? new Error(`سرویس هوش مصنوعی در دسترس نیست: ${e.message}`) : e;
  }

  const type: CampaignType = (["seasonal", "content", "paid"] as const).includes(parsed.type as CampaignType) ? (parsed.type as CampaignType) : "content";
  const known = new Set(products.map((p) => p.url));
  const productUrls = Array.isArray(parsed.product_urls) ? (parsed.product_urls as unknown[]).filter((u): u is string => typeof u === "string" && known.has(u)) : [];
  const start = DATE_RE.test(String(parsed.start_date)) ? String(parsed.start_date) : todayJalali;
  const end = DATE_RE.test(String(parsed.end_date)) ? String(parsed.end_date) : "";
  const discount = typeof parsed.discount_percent === "number" && parsed.discount_percent > 0 && parsed.discount_percent <= 90 ? parsed.discount_percent : null;

  return create(pid, createdBy, {
    name: (title || String(parsed.name || "")).slice(0, 200) || "کمپین پیشنهادی",
    type, status: "planned",
    goal: String(parsed.goal || "").slice(0, 300),
    channel: String(parsed.channel || "").slice(0, 100),
    start_date: start, end_date: end,
    discount_percent: discount,
    discount_note: String(parsed.discount_note || "").slice(0, 300),
    product_urls: productUrls,
    note: `(پیشنهاد هوش مصنوعی — بررسی و ویرایش کن) ${String(parsed.note || "").slice(0, 400)}`,
  });
}
