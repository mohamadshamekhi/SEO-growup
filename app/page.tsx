import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { role, visibleProjects } from "@/lib/auth";
import { uptimeStats } from "@/lib/overview";
import { faNum } from "@/lib/intl/fa";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

const ROLE_FA: Record<string, string> = { admin: "مدیر", editor: "ویرایشگر", viewer: "فقط مشاهده" };

export default async function ProjectsPicker() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const projects = visibleProjects(user);

  return (
    <div className="picker">
      <div className="picker-top">
        <span className="brand-mark"><Icon name="trend" /></span>
        <span style={{ fontWeight: 700 }}>Growth Hub</span>
      </div>
      <h1>کدام پروژه را باز کنم؟</h1>
      {!projects.length && <div className="empty-inline"><p>هنوز پروژه‌ای برای تو تعریف نشده.</p></div>}
      <div className="pick-grid">
        {projects.map((p) => {
          const up = uptimeStats(p.id);
          const r = role(user, p.id);
          return (
            <Link key={p.id} className="pick" href={`/p/${p.id}/dash`}>
              <span className="pick-bar" style={{ background: p.color }} />
              <div className="pick-head">
                <strong>{p.name}</strong>
                {r && <span className="chip">{ROLE_FA[r] || r}</span>}
              </div>
              <span className="mono muted">{p.domain}</span>
              <div className="pick-meta">
                <span className={`chip ${up.pct != null && up.pct < 99 ? "danger" : "ok"}`}>
                  آپتایم: {up.pct == null ? "—" : `${faNum(up.pct, 1)}٪`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
