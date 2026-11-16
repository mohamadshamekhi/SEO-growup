import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { CHECKS } from "@/lib/checks";
import { GUIDE, COVERAGE } from "@/lib/guide";
import { catalogRows } from "@/lib/catalog";
import { U } from "@/lib/crawl";
import { canAutoFix } from "@/lib/issue-autofix";
import { faNum } from "@/lib/intl/fa";
import { IssuesClient } from "./issues-client";

export const dynamic = "force-dynamic";

export default async function IssuesTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { projectId } = await params;
  const { status = "open" } = await searchParams;
  if (!project(projectId)) notFound();

  const rows = q<{ id: number; code: string; severity: string; url: string; detail: string; status: string }>(
    `SELECT * FROM issues WHERE project_id=? AND (?='all' OR status=?)
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code, url`,
    projectId, status, status,
  );
  const catalog = new Map(catalogRows(projectId).map((c) => [U(c.url), c]));
  const norm = (v: string) => (v || "").trim().replace(/\s+/g, " ");
  // URLs Google/sitemap already report as redirecting: a "duplicate" with one of these is the
  // same page reachable at two addresses, not two pages needing different text.
  const redirecting = new Set(
    q<{ url: string; code: string; detail: string }>("SELECT url, code, detail FROM issues WHERE project_id=? AND status='open' AND code IN ('redirect_in_sitemap','not_indexed')", projectId)
      .filter((r) => r.code === "redirect_in_sitemap" || r.detail === "Page with redirect")
      .flatMap((r) => [U(r.url), ...(r.code === "redirect_in_sitemap" && r.detail.startsWith("http") ? [U(r.detail)] : [])]),
  );

  const withLabels = rows.map((r) => {
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
      guide: g ? { ...g, coverage: r.code === "not_indexed" ? COVERAGE[r.detail] || "" : "", related, viaRedirect } : null,
    };
  });

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>سلامت فنی</h1></div></div>
      <p className="page-note">{faNum(withLabels.length)} مورد با وضعیت «{status === "open" ? "باز" : status}»</p>
      <IssuesClient projectId={projectId} initialRows={withLabels} />
    </div>
  );
}
