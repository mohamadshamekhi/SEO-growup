import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { listing } from "@/lib/campaigns";
import { faNum } from "@/lib/intl/fa";
import { CampaignsClient } from "./campaigns-client";

export const dynamic = "force-dynamic";

export default async function CampaignsTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const rows = listing(projectId);

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>کمپین‌ها</h1></div></div>
      <p className="page-note">{faNum(rows.length)} کمپین؛ فصلی/تخفیفی، محتوایی و تبلیغاتی پولی</p>
      <CampaignsClient projectId={projectId} initial={rows} />
    </div>
  );
}
