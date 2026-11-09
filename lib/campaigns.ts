// New feature, no Python reference to port — covers 3 campaign types in one table
// (seasonal/discount, content-goal, paid-ads) since they share name/status/date/note shape
// and only differ in a few optional fields. Metrics/budget/spend are manual entries only;
// no ads API is connected.
import { now, one, q, run } from "./db";

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
  run("DELETE FROM campaigns WHERE id=?", id);
}
