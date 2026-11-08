import { notFound, redirect } from "next/navigation";
import { project } from "@/lib/projects";
import { publicConfig } from "@/lib/adapters";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { AdapterClient } from "./adapter-client";

export const dynamic = "force-dynamic";

export default async function SettingsTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (role(user, projectId) !== "admin") redirect(`/p/${projectId}/dash`);

  return (
    <div>
      <h1>تنظیمات {p.name}</h1>
      <AdapterClient projectId={projectId} initialAdapter={publicConfig(projectId)} />
    </div>
  );
}
