import { notFound, redirect } from "next/navigation";
import { project } from "@/lib/projects";
import { publicConfig } from "@/lib/adapters";
import { tgPublic } from "@/lib/publisher";
import { getGuide } from "@/lib/content";
import { get as getPolicy } from "@/lib/policy";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { AdapterClient } from "./adapter-client";
import { TelegramClient } from "./telegram-client";
import { GuideClient } from "./guide-client";
import { PolicyClient } from "./policy-client";
import { DeleteProjectButton } from "./delete-project-button";
import { ProjectForm } from "@/components/ProjectForm";

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
      <div className="page-head"><div className="head-title"><h1>تنظیمات {p.name}</h1></div></div>
      <section className="panel narrow">
        <h3>پروژه</h3>
        <ProjectForm initial={{ id: p.id, name: p.name, domain: p.domain, color: p.color, logo_url: p.logo_url, sitemap: p.sitemap, max_pages: p.max_pages, gsc_property: p.gsc_property, keywords: p.keywords, competitors: p.competitors }} />
      </section>
      <section className="panel narrow">
        <h3>اتصال به API سایت</h3>
        <AdapterClient projectId={projectId} initialAdapter={publicConfig(projectId)} />
      </section>
      <PolicyClient projectId={projectId} initial={getPolicy(projectId)} />
      <TelegramClient projectId={projectId} initial={tgPublic(projectId)} />
      <GuideClient projectId={projectId} initial={getGuide(projectId)} />
      <section className="panel narrow" style={{ marginTop: 14, borderColor: "var(--danger)" }}>
        <h3>حذف پروژه</h3>
        <p className="muted">همه داده‌های این پروژه در Growth Hub (تاریخچه، مشکلات، آپتایم، عکس‌ها) پاک می‌شود. روی سایت اثری ندارد.</p>
        <DeleteProjectButton projectId={projectId} projectName={p.name} />
      </section>
    </div>
  );
}
