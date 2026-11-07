import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { role, visibleProjects } from "@/lib/auth";
import { uptimeStats } from "@/lib/overview";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

export default async function ProjectsPicker() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const projects = visibleProjects(user);

  return (
    <main style={{ padding: 32, fontFamily: "Vazirmatn, sans-serif", maxWidth: 720 }}>
      <h1>کدام پروژه را باز کنم؟</h1>
      {!projects.length && <p>هنوز پروژه‌ای برای تو تعریف نشده.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {projects.map((p) => {
          const up = uptimeStats(p.id);
          return (
            <li key={p.id}>
              <Link href={`/p/${p.id}/dash`} style={{ display: "block", border: "1px solid #333", borderRadius: 10, padding: 14 }}>
                <strong>{p.name}</strong>
                <div style={{ fontSize: 13, opacity: 0.7 }} className="ltr mono">{p.domain}</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  نقش: {role(user, p.id)} · آپتایم: {up.pct == null ? "—" : `${faNum(up.pct, 1)}٪`}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
