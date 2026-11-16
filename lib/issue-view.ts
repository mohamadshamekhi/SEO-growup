// Shared by the Issues and Pages tabs: turns raw issue rows into what IssuesClient renders —
// label, whether a one-click fix exists, and the plain-language explanation with page context.
import { q } from "./db";
import { CHECKS } from "./checks";
import { GUIDE, COVERAGE } from "./guide";
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { canAutoFix } from "./issue-autofix";
import { cachedDiagnosis } from "./issue-diagnose";

const TEXT_ONLY = new Set(["missing_title", "title_length", "missing_description", "description_length", "duplicate_title", "duplicate_description"]);

export type IssueDbRow = { id: number; code: string; severity: string; url: string; detail: string; status: string };

export function enrichIssues(projectId: string, rows: IssueDbRow[]) {
  const catalog = new Map(catalogRows(projectId).map((c) => [U(c.url), c]));
  const norm = (v: string) => (v || "").trim().replace(/\s+/g, " ");
  // URLs Google/sitemap already report as redirecting: a "duplicate" with one of these is the
  // same page reachable at two addresses, not two pages needing different text.
  const redirecting = new Set(
    q<{ url: string; code: string; detail: string }>("SELECT url, code, detail FROM issues WHERE project_id=? AND status='open' AND code IN ('redirect_in_sitemap','not_indexed')", projectId)
      .filter((r) => r.code === "redirect_in_sitemap" || r.detail === "Page with redirect")
      .flatMap((r) => [U(r.url), ...(r.code === "redirect_in_sitemap" && r.detail.startsWith("http") ? [U(r.detail)] : [])]),
  );

  return rows.map((r) => {
    const c = CHECKS[r.code];
    const g = GUIDE[r.code];
    const cat = catalog.get(U(r.url));
    let related: string[] = [];
    if (cat && (r.code === "duplicate_title" || r.code === "duplicate_description")) {
      const v = norm(r.code === "duplicate_title" ? cat.title : cat.meta);
      related = v ? [...catalog.values()].filter((o) => U(o.url) !== U(r.url) && norm(r.code === "duplicate_title" ? o.title : o.meta) === v).map((o) => o.url) : [];
    } else if (cat && r.code === "img_no_alt") {
      related = (cat.no_alt || []).slice(0, 8);
    }
    const viaRedirect = (r.code === "duplicate_title" || r.code === "duplicate_description") && [r.url, ...related].some((u) => redirecting.has(U(u)));
    return {
      ...r,
      label: c ? c[1] : r.code,
      fix: c ? c[2] : "",
      canFix: canAutoFix(r.code, r.url) && !viaRedirect,
      diagnosis: cachedDiagnosis(r.id),
      // Anything that isn't purely a text field can be (partly) a code/template problem.
      technical: !TEXT_ONLY.has(r.code),
      guide: g ? { ...g, coverage: r.code === "not_indexed" ? COVERAGE[r.detail] || "" : "", related, viaRedirect } : null,
    };
  });
}
