import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { project } from "@/lib/projects";

// Replaces server.py's access() check for everything under /api/projects/:id/* — here it
// gates everything under /p/:projectId/* in one place instead of per-route, since the whole
// subtree needs the same "any role, else 404" rule (not 403 — hides the project's existence).
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { projectId } = await params;
  const p = project(projectId);
  const myRole = p ? role(user, projectId) : null;
  if (!p || !myRole) notFound();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, borderInlineEnd: "1px solid #333", padding: 16 }}>
        <Link href="/">همه پروژه‌ها</Link>
        <h2 style={{ marginTop: 16 }}>{p.name}</h2>
        <nav style={{ display: "grid", gap: 6, marginTop: 12 }}>
          <Link href={`/p/${projectId}/dash`}>داشبورد</Link>
          <Link href={`/p/${projectId}/issues`}>مشکلات</Link>
          <Link href={`/p/${projectId}/pages`}>صفحات</Link>
          <Link href={`/p/${projectId}/uptime`}>آپتایم</Link>
          <Link href={`/p/${projectId}/gsc`}>سرچ کنسول</Link>
          <Link href={`/p/${projectId}/catalog`}>محصولات</Link>
          <Link href={`/p/${projectId}/tasks`}>کارها</Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 24, fontFamily: "Vazirmatn, sans-serif" }}>{children}</main>
    </div>
  );
}
