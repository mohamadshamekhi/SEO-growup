// Ported from public/app.js's tabContent(). The write button (queueing Claude to write N
// items) is wired (lib/content.ts's add()); drafting-to-site/publish/image-generation
// sub-actions aren't in this pass.
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { listing } from "@/lib/content";
import { one } from "@/lib/db";
import { ContentClient } from "./content-client";

export const dynamic = "force-dynamic";

export default async function ContentTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();

  const items = listing(projectId);
  const catalogSize = one<{ n: number }>("SELECT COUNT(*) n FROM catalog WHERE project_id=?", projectId)!.n;

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>محتوا</h1></div></div>
      <ContentClient projectId={projectId} initialItems={items} catalogSize={catalogSize} />
    </div>
  );
}
