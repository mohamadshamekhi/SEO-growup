// Ported 1:1 from hub/policy.py. Fully self-contained (DB + lib/adapters.ts's config()/
// undoApplied()) — no dependency on anything still unported.
import { config, undoApplied } from "./adapters";
import { getSetting, one, q, run, setSetting } from "./db";
import type { ProjectRow } from "./projects";

export const GROUPS = { meta: ["kw_title", "kw_description"], faq: ["kw_faq"], content: ["kw_refresh", "cro_description"] } as const;
type GroupKey = keyof typeof GROUPS;
export const LEVELS = ["approve", "auto"] as const;
export const ROLLBACK_MODES = ["off", "alert", "auto"] as const;
export const DAILY_CAP = 10;
export const AUTO_USER = "سطح اختیار خودکار";

export type Policy = { meta: "approve" | "auto"; faq: "approve" | "auto"; content: "approve" | "auto"; rollback: "off" | "alert" | "auto" };
const DEFAULT: Policy = { meta: "approve", faq: "approve", content: "approve", rollback: "alert" };

export function get(pid: string): Policy {
  return { ...DEFAULT, ...getSetting<Partial<Policy>>(`policy:${pid}`, {}) };
}

export function save(pid: string, b: Partial<Policy>): Policy {
  const cur = get(pid);
  for (const k of Object.keys(GROUPS) as GroupKey[]) {
    const v = b[k];
    if (v !== undefined) {
      if (!(LEVELS as readonly string[]).includes(v)) throw new Error("سطح نامعتبر");
      cur[k] = v;
    }
  }
  if (b.rollback !== undefined) {
    if (!(ROLLBACK_MODES as readonly string[]).includes(b.rollback)) throw new Error("حالت برگشت نامعتبر");
    cur.rollback = b.rollback;
  }
  setSetting(`policy:${pid}`, cur);
  return cur;
}

/** Ready changes this project allows without a click, a few a day so one bad batch can't touch the whole site at once. */
export function tick(pid: string, now?: number): number[] {
  if (!config(pid)) return [];
  now = now ?? Date.now() / 1000;
  const p = get(pid);
  const types: string[] = [];
  for (const g of Object.keys(GROUPS) as GroupKey[]) if (p[g] === "auto") types.push(...GROUPS[g]);
  if (!types.length) return [];
  const used = one<{ n: number }>("SELECT COUNT(*) n FROM applied WHERE project_id=? AND user_name=? AND ts>?", pid, AUTO_USER, now - 86400)!.n;
  const room = DAILY_CAP - used;
  if (room <= 0) return [];
  const placeholders = types.map(() => "?").join(",");
  const ids = q<{ id: number }>(
    `SELECT id FROM fixes WHERE project_id=? AND status='pending' AND proposed!='' AND apply_error='' AND type IN (${placeholders}) ORDER BY url, type LIMIT ?`,
    pid, ...types, room,
  ).map((r) => r.id);
  if (ids.length) run(`UPDATE fixes SET status='approved', updated=? WHERE id IN (${ids.map(() => "?").join(",")})`, now, ...ids);
  return ids;
}

type WorseRow = { applied_id: number; url: string; why: string };

function worse(pid: string): WorseRow[] {
  const seo = q<{ applied_id: number; url: string; b: number | null; a: number | null }>(
    "SELECT i.applied_id, i.url, i.position_before b, i.position_after a FROM impact i JOIN applied x ON x.id=i.applied_id AND x.undone=0 WHERE i.project_id=? AND i.verdict='worse'", pid,
  ).map((r) => ({ applied_id: r.applied_id, url: r.url, why: r.b && r.a ? `جایگاه گوگل از ${Math.round(r.b)} به ${Math.round(r.a)} رسید` : "نمایش این صفحه در گوگل کم شد" }));
  const sale = q<{ applied_id: number; url: string }>(
    "SELECT e.applied_id, e.url FROM experiments e JOIN applied x ON x.id=e.applied_id AND x.undone=0 WHERE e.project_id=? AND e.verdict='worse'", pid,
  ).map((r) => ({ ...r, why: "بازدید یا فروش صفحه بعد از تغییر کم شد" }));
  return [...seo, ...sale];
}

/** Each hurt change is acted on once. Returns the sentences to tell the team. A measured drop
 * can also be Google's own swing, so the default only warns. */
export async function watch(project: ProjectRow, now?: number): Promise<string[]> {
  const pid = project.id;
  now = now ?? Date.now() / 1000;
  const out: string[] = [];
  const mode = get(pid).rollback;
  if (mode === "off") return out;
  for (const w of worse(pid)) {
    if (one("SELECT 1 FROM rollbacks WHERE applied_id=?", w.applied_id)) continue;
    let done = "alert";
    if (mode === "auto") {
      try { await undoPage(pid, w.url, w.applied_id); done = "undone"; }
      catch (e) { done = `failed: ${String((e as Error).message || e).slice(0, 120)}`; }
    }
    run("INSERT INTO rollbacks(applied_id,project_id,url,reason,action,ts) VALUES (?,?,?,?,?,?)", w.applied_id, pid, w.url, w.why, done, now);
    out.push(`${w.url}: ${w.why}؛ ` + (done === "undone" ? "تغییر خودکار برگشت داده شد." : done.startsWith("failed") ? "برگشت خودکار انجام نشد." : "اگر لازم است از فهرست تغییرهای ثبت‌شده برگردان."));
  }
  return out;
}

/** Title and description go on together, so they come back together; a rolled-back proposal isn't offered again. */
export async function undoPage(pid: string, url: string, appliedId: number) {
  const a = one<{ ts: number }>("SELECT ts FROM applied WHERE id=?", appliedId);
  if (!a) return;
  for (const r of q<{ id: number; fix_id: number }>(
    "SELECT id, fix_id FROM applied WHERE project_id=? AND url=? AND undone=0 AND type!='publish' AND ABS(ts-?)<86400", pid, url, a.ts,
  )) {
    await undoApplied(r.id);
    run("UPDATE fixes SET status='rejected', updated=? WHERE id=?", Date.now() / 1000, r.fix_id);
  }
}

function day(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Newest first, so several changes to a page unwind in order. A page changed again by
 * something outside this batch is left alone: its old value would wipe the newer one. */
export function undoCandidates(pid: string, typ?: string, dayFilter?: string): [number[], number] {
  const rows = q<{ id: number; url: string; type: string; ts: number }>(
    "SELECT id, url, type, ts FROM applied WHERE project_id=? AND undone=0 AND type!='publish' ORDER BY ts DESC, id DESC", pid,
  );
  const picked = new Set(rows.filter((r) => (!typ || r.type === typ) && (!dayFilter || day(r.ts) === dayFilter)).map((r) => r.id));
  const newestOutside = new Map<string, number>();
  const ids: number[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (!picked.has(r.id)) {
      if (!newestOutside.has(r.url)) newestOutside.set(r.url, r.ts);
    } else if ((newestOutside.get(r.url) ?? 0) > r.ts) {
      skipped++;
    } else {
      ids.push(r.id);
    }
  }
  return [ids, skipped];
}

export async function undoBatch(pid: string, ids: number[], progress: (done: number, total: number, message: string) => void = () => {}) {
  let done = 0, failed = 0, first = "";
  for (let i = 0; i < ids.length; i++) {
    const aid = ids[i];
    progress(i, ids.length, "برگرداندن تغییرها");
    const a = one<{ fix_id: number }>("SELECT fix_id FROM applied WHERE id=? AND project_id=?", aid, pid);
    if (!a) continue;
    try {
      await undoApplied(aid);
      run("UPDATE fixes SET status='rejected', updated=? WHERE id=?", Date.now() / 1000, a.fix_id); // a rolled-back proposal isn't offered again
      done++;
    } catch (e) {
      failed++; first = first || String((e as Error).message || e).slice(0, 200);
    }
  }
  return { undone: done, failed, error: first };
}

export function batches(pid: string, limit = 14) {
  const days = new Map<string, { day: string; ts: number; count: number }>();
  for (const r of q<{ ts: number }>("SELECT ts FROM applied WHERE project_id=? AND undone=0 AND type!='publish' ORDER BY ts DESC", pid)) {
    const d = day(r.ts);
    if (!days.has(d)) days.set(d, { day: d, ts: r.ts, count: 0 });
    days.get(d)!.count++;
  }
  return [...days.values()].slice(0, limit);
}

export function rollbacks(pid: string, limit = 30) {
  return q("SELECT url, reason, action, ts FROM rollbacks WHERE project_id=? ORDER BY ts DESC LIMIT ?", pid, limit);
}
