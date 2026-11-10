// Ported from public/app.js's tabMembers(). Admin-only (matches Python's role gate).
import { notFound, redirect } from "next/navigation";
import { project } from "@/lib/projects";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { q } from "@/lib/db";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

export default async function MembersTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (role(user, projectId) !== "admin") redirect(`/p/${projectId}/dash`);

  const members = q<{ id: number; name: string; username: string; active: number; last_login: number | null; role: string }>(
    "SELECT u.id, u.name, u.username, u.active, u.last_login, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name", projectId,
  );
  const allUsers = q<{ id: number; name: string; username: string; is_admin: number }>("SELECT id, name, username, is_admin FROM users ORDER BY is_admin DESC, name");
  const taken = new Set(members.map((m) => m.id));
  const free = allUsers.filter((u) => !taken.has(u.id) && !u.is_admin);
  const admins = allUsers.filter((u) => u.is_admin);

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>اعضا</h1></div></div>
      <section className="panel narrow">
        <h3>اعضای {p.name}</h3>
        <p className="muted">هر عضو فقط پروژه‌هایی را می‌بیند که اینجا به او داده شده. ویرایشگر می‌تواند ممیزی اجرا و اصلاح‌ها و محتوا را تأیید کند؛ «فقط مشاهده» چیزی را تغییر نمی‌دهد.</p>
        <MembersClient projectId={projectId} initialMembers={members} freeUsers={free} />
        <p className="muted small">مدیرها همیشه به همه پروژه‌ها دسترسی دارند: {admins.map((a) => a.name).join("، ")}</p>
      </section>
    </div>
  );
}
