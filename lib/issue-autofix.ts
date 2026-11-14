// The "رفع خودکار" button on an Issues-tab row. Honest about scope: only issue codes that
// map cleanly to a single writable field (seo_title/meta_description) on a page the catalog
// already recognizes get a real one-click AI-write-apply. Duplicate_title/duplicate_description
// need cross-page uniqueness context a single-row prompt can't give safely, so those (and
// every structural/server-side code — robots.txt, sitemap, schema, broken links, HSTS...)
// are refused with a clear reason instead of faking a fix, same spirit as lib/jobs/queues.ts's
// NOT_IMPLEMENTED set.
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { now as dbNow, one, run } from "./db";
import { askAI, AIGatewayError } from "./ai";
import { RULES, setFix, buildFixPrompt, type FixRowForWriter } from "./content";
import * as adapters from "./adapters";
import type { ProjectRow } from "./projects";

const CODE_TYPE: Record<string, "seo_title" | "meta_description"> = {
  missing_title: "seo_title",
  title_length: "seo_title",
  missing_description: "meta_description",
  description_length: "meta_description",
};

const DETAIL: Record<"seo_title" | "meta_description", string> = {
  seo_title: "حداکثر ۶۵ کاراکتر",
  meta_description: "باید ۱۲۰ تا ۱۶۰ کاراکتر باشد",
};

export type IssueAutoFixResult =
  | { ok: true; applied: boolean; proposed: string; reason?: string }
  | { ok: false; reason: string };

export async function autoFixIssue(project: ProjectRow, user: string, issueId: number): Promise<IssueAutoFixResult> {
  const issue = one<{ id: number; code: string; url: string }>("SELECT id, code, url FROM issues WHERE id=? AND project_id=?", issueId, project.id);
  if (!issue) return { ok: false, reason: "مشکل پیدا نشد" };

  const type = CODE_TYPE[issue.code];
  if (!type) {
    const crossPage = issue.code === "duplicate_title" || issue.code === "duplicate_description";
    return { ok: false, reason: crossPage ? "عنوان/توضیح تکراری نیاز به بررسی همه صفحات مشابه دارد؛ از تب «اصلاحات متنی» استفاده کنید." : "این نوع مشکل خودکار رفع نمی‌شود؛ نیاز به تغییر دستی روی سایت/سرور دارد." };
  }

  const url = U(issue.url);
  const cat = catalogRows(project.id).find((r) => U(r.url) === url);
  if (!cat) return { ok: false, reason: "این صفحه هنوز در کاتالوگ شناسایی نشده؛ اول تب «محصولات» را به‌روزرسانی کنید." };
  const current = type === "seo_title" ? cat.title : cat.meta;

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
        project.id, url, type, "warning", current, "", DETAIL[type], now, now,
      ).lastInsertRowid,
    );
  } else {
    fixId = fix.id;
  }

  if (!fix?.proposed) {
    const row: FixRowForWriter = { id: fixId, url, type, current, detail: DETAIL[type] };
    try {
      const raw = await askAI(buildFixPrompt(RULES.fixes, row));
      const text = raw.trim().replace(/^[«"'`]+|[»"'`]+$/g, "");
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
  return { ok: true, applied: true, proposed };
}
