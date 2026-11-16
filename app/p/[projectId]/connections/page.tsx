import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { list } from "@/lib/connections";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { keyInfo } from "@/lib/google-auth";
import { getProperty } from "@/lib/ga";
import { ConnectionsClient } from "./connections-client";

export const dynamic = "force-dynamic";

export default async function ConnectionsTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  const r = user ? role(user, projectId) : null;
  const key = keyInfo();
  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>اتصال‌ها</h1></div></div>
      <p className="page-note">همه سرویس‌های بیرونی که پنل به آن‌ها وصل است. «تست» هر کدام را همین حالا واقعاً امتحان می‌کند و خطای دقیق را نشان می‌دهد.</p>
      <ConnectionsClient
        projectId={projectId}
        initial={list(p)}
        canEdit={r === "admin" || r === "editor"}
        gscProperty={p.gsc_property || ""}
        gaProperty={getProperty(projectId)}
        serviceEmail={key && "client_email" in key ? key.client_email : ""}
      />
    </div>
  );
}
