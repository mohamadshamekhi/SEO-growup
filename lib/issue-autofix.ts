// The "رفع خودکار" button on an Issues-tab row. Only issue codes that map cleanly to a single
// writable field (seo_title/meta_description) on a page the catalog recognizes get a real
// one-click AI-write-apply. Duplicates are fixed per page: the prompt is told the current text
// is shared, and the result must differ from it; once one of a pair is rewritten, the other
// stops being a duplicate too. Duplicate *article* titles (the article's own heading) and every
// structural/server-side code are refused; the tab shows a full explanation for those instead.
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { now as dbNow, one, q, run } from "./db";
import { askAI, AIGatewayError } from "./ai";
import { RULES, setFix, buildFixPrompt, type FixRowForWriter } from "./content";
import * as adapters from "./adapters";
import type { ProjectRow } from "./projects";

const CODE_TYPE: Record<string, "seo_title" | "meta_description"> = {
  missing_title: "seo_title",
  title_length: "seo_title",
  missing_description: "meta_description",
  description_length: "meta_description",
  duplicate_title: "seo_title",
  duplicate_description: "meta_description",
};

const DUP = new Set(["duplicate_title", "duplicate_description"]);

/** Same rule the client uses to decide whether to show the button. Article titles are the
 * article's own heading (not a separate SEO field), so duplicate article titles are never auto-rewritten. */
export function canAutoFix(code: string, url: string): boolean {
  if (!CODE_TYPE[code]) return false;
  if (code === "duplicate_title" && !url.includes("/product/")) return false;
  return true;
}

const DETAIL: Record<"seo_title" | "meta_description", string> = {
  seo_title: "حداکثر ۶۵ کاراکتر",
  meta_description: "باید ۱۲۰ تا ۱۶۰ کاراکتر باشد",
};

export type IssueAutoFixResult =
  | { ok: true; applied: boolean; proposed: string; reason?: string; fixedIds?: number[] }
  | { ok: false; reason: string };

export async function autoFixIssue(project: ProjectRow, user: string, issueId: number): Promise<IssueAutoFixResult> {
  const issue = one<{ id: number; code: string; url: string }>("SELECT id, code, url FROM issues WHERE id=? AND project_id=?", issueId, project.id);
  if (!issue) return { ok: false, reason: "مشکل پیدا نشد" };

  const type = CODE_TYPE[issue.code];
  if (!type || !canAutoFix(issue.code, issue.url)) {
    return { ok: false, reason: "این نوع مشکل خودکار رفع نمی‌شود؛ دکمه «توضیح» را بزنید تا علت و راه رفع را ببینید." };
  }
  const dup = DUP.has(issue.code);

  const url = U(issue.url);
  const cat = catalogRows(project.id).find((r) => U(r.url) === url);
  if (!cat) return { ok: false, reason: "این صفحه هنوز در کاتالوگ شناسایی نشده؛ اول تب «محصولات» را به‌روزرسانی کنید." };
  const current = type === "seo_title" ? cat.title : cat.meta;
  const norm = (v: string) => (v || "").trim().replace(/\s+/g, " ");
  const field = (r: { title: string; meta: string }) => norm(type === "seo_title" ? r.title : r.meta);
  // Other pages that currently share this exact text; the new text must not collide with any page.
  const siblings = dup ? catalogRows(project.id).filter((r) => U(r.url) !== url && field(r) && field(r) === norm(current)) : [];
  const detail = dup
    ? `${DETAIL[type]}؛ همین متن الان روی ${siblings.length} صفحه دیگر هم هست، پس متن جدید باید کاملاً یکتا، مخصوص همین صفحه و متفاوت با متن فعلی باشد`
    : DETAIL[type];

  const now = dbNow();
  const fix = one<{ id: number; proposed: string }>(
    "SELECT id, proposed FROM fixes WHERE project_id=? AND url=? AND type=? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1",
    project.id, url, type,
  );
  let fixId: number;
  if (!fix) {
    fixId = Number(
      run(
        "INSERT INTO fixes(project_id,url,type,severity,current,proposed,detail,status,created,updated) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
        project.id, url, type, "warning", current, "", detail, now, now,
      ).lastInsertRowid,
    );
  } else {
    fixId = fix.id;
    if (dup) run("UPDATE fixes SET detail=?, current=?, proposed='', updated=? WHERE id=?", detail, current, now, fixId);
  }

  if (!fix?.proposed || dup) {
    const row: FixRowForWriter = { id: fixId, url, type, current, detail };
    try {
      const raw = await askAI(buildFixPrompt(RULES.fixes, row));
      const text = raw.trim().replace(/^[«"'`]+|[»"'`]+$/g, "");
      if (dup && norm(text) === norm(current)) throw new Error("متن پیشنهادی با متن تکراری فعلی یکی بود؛ دوباره امتحان کنید.");
      setFix(fixId, text); // throws if the model ignored the length rule
    } catch (e) {
      return { ok: false, reason: e instanceof AIGatewayError ? `سرویس هوش مصنوعی در دسترس نیست: ${e.message}` : (e as Error).message };
    }
  }
  const proposed = one<{ proposed: string }>("SELECT proposed FROM fixes WHERE id=?", fixId)!.proposed;

  const cfg = adapters.config(project.id);
  if (!cfg || !(adapters.WRITABLE[cfg.type] || []).includes(type)) {
    return { ok: true, applied: false, proposed, reason: "سایت متصل نیست یا این نوع فیلد روی آن قابل نوشتن نیست؛ متن پیشنهادی در تب «اصلاحات متنی» ذخیره شد." };
  }

  run("UPDATE fixes SET status='approved', updated=? WHERE id=?", now, fixId);
  await adapters.applyFixes(project, [fixId], user);
  const after = one<{ status: string; apply_error: string }>("SELECT status, apply_error FROM fixes WHERE id=?", fixId)!;
  if (after.status !== "done") return { ok: false, reason: after.apply_error || "اعمال روی سایت ناموفق بود" };

  run("UPDATE issues SET status='fixed', fixed_at=? WHERE id=?", now, issue.id);
  const fixedIds = [issue.id];
  // With this page rewritten, a lone remaining sibling is no longer a duplicate either.
  if (dup && siblings.length === 1) {
    const target = U(siblings[0].url);
    const sib = q<{ id: number; url: string }>("SELECT id, url FROM issues WHERE project_id=? AND code=? AND status='open'", project.id, issue.code).find((r) => U(r.url) === target);
    if (sib) { run("UPDATE issues SET status='fixed', fixed_at=? WHERE id=?", now, sib.id); fixedIds.push(sib.id); }
  }
  return { ok: true, applied: true, proposed, fixedIds };
}
