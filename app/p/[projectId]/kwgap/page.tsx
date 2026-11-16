import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { one, q } from "@/lib/db";
import { analyse, domains, newPages } from "@/lib/kwgap";
import { cannibal } from "@/lib/keywords";
import { catalogRows } from "@/lib/catalog";
import { U } from "@/lib/crawl";
import { SCORE_HELP } from "@/lib/kwgap-clean";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { KwgapClient, type DecayRow } from "./kwgap-client";

export const dynamic = "force-dynamic";

export default async function KwgapTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { projectId } = await params;
  const { tab = "gap" } = await searchParams;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  const r = user ? role(user, projectId) : null;

  const d = analyse(p, 1000);
  const titles = new Map<string, string>();
  for (const c of catalogRows(projectId)) titles.set(U(c.url), c.name || c.title);
  for (const pg of q<{ url: string; title: string }>("SELECT url, title FROM pages WHERE run_id=(SELECT MAX(id) FROM runs WHERE project_id=? AND kind='audit' AND status='ok')", projectId)) if (!titles.has(U(pg.url))) titles.set(U(pg.url), pg.title);

  // Pages losing ground: position worse by 3+ or clicks down 40%+ vs the previous 28 days.
  const snap = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='page'", projectId)?.s;
  const decay: DecayRow[] = snap
    ? q<{ key: string; clicks: number; prev_clicks: number | null; position: number; prev_position: number | null; impressions: number }>(
        `SELECT key, clicks, prev_clicks, position, prev_position, impressions FROM gsc_snap WHERE project_id=? AND snap=? AND dim='page'
         AND ((prev_position IS NOT NULL AND position-prev_position>=3) OR (prev_clicks>=3 AND clicks<=prev_clicks*0.6)) ORDER BY impressions DESC LIMIT 60`, projectId, snap,
      ).map((x) => ({ url: x.key, title: titles.get(U(x.key)) || "", clicks: x.clicks, prev_clicks: x.prev_clicks, position: x.position, prev_position: x.prev_position, impressions: x.impressions }))
    : [];

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>کلمات</h1></div></div>
      <p className="page-note">موضوع‌هایی که رقبا برایشان صفحه دارند و شما ندارید یا در گوگل دیده نمی‌شوید؛ پاک‌سازی‌شده، هم‌خانواده‌ها یکی‌شده، و فقط آن‌هایی که به محصولات و جستجوهای خود سایت ربط دارند.</p>
      <KwgapClient
        projectId={projectId}
        canEdit={r === "admin" || r === "editor"}
        initialTab={tab}
        rows={d.rows}
        hasGsc={d.has_gsc}
        competitors={domains(p)}
        offTopic={d.off_topic}
        scoreHelp={SCORE_HELP}
        cannibal={cannibal(projectId, 40).map((c) => ({ ...c, pages: c.pages.map((pg) => ({ ...pg, title: titles.get(U(pg.url)) || "" })) }))}
        decay={decay}
        compNew={newPages(projectId, 45, 60)}
      />
    </div>
  );
}
