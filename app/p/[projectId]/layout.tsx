import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { project } from "@/lib/projects";
import Icon from "@/components/Icon";
import ProjectNavItem from "@/components/ProjectNav";

// Replaces server.py's access() check for everything under /api/projects/:id/* — here it
// gates everything under /p/:projectId/* in one place instead of per-route, since the whole
// subtree needs the same "any role, else 404" rule (not 403 — hides the project's existence).
const NAV: [string, string, string][] = [
  ["dash", "داشبورد", "grid"],
  ["issues", "سلامت فنی", "alert"],
  ["fixes", "اصلاحات متنی", "check"],
  ["pages", "صفحات", "file"],
  ["uptime", "آپتایم", "activity"],
  ["gsc", "سرچ کنسول", "search"],
  ["catalog", "محصولات", "file"],
  ["funnel", "فروش", "dollar"],
  ["opps", "فرصت‌ها", "bulb"],
  ["campaigns", "کمپین‌ها", "send"],
  ["content", "محتوا", "trend"],
  ["kwgap", "کلمات", "search"],
  ["tasks", "کارها", "check"],
  ["schedule", "زمان‌بندی", "clock"],
];
const ADMIN_NAV: [string, string, string][] = [
  ["members", "اعضا", "users"],
  ["settings", "تنظیمات", "gear"],
];

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { projectId } = await params;
  const p = project(projectId);
  const myRole = p ? role(user, projectId) : null;
  if (!p || !myRole) notFound();
  const isAdmin = myRole === "admin";

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark"><Icon name="trend" /></span>
          Growth Hub
        </div>
        <Link className="nav-item" href="/">
          <Icon name="grid" /><span className="grow">همه پروژه‌ها</span>
        </Link>
        <div className="side-label"><span>{p.name}</span></div>
        {NAV.map(([key, label, ic]) => (
          <ProjectNavItem key={key} href={`/p/${projectId}/${key}`} icon={ic} label={label} />
        ))}
        {isAdmin && (
          <>
            <div className="side-label"><span>مدیریت</span></div>
            {ADMIN_NAV.map(([key, label, ic]) => (
              <ProjectNavItem key={key} href={`/p/${projectId}/${key}`} icon={ic} label={label} />
            ))}
            <ProjectNavItem href="/settings" icon="gear" label="تنظیمات کلی پنل" />
          </>
        )}
      </aside>
      <div className="content">
        <main>{children}</main>
      </div>
    </div>
  );
}
