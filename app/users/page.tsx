// Ported from public/app.js's renderMembers() — the global, all-projects user list (not to
// be confused with the per-project /p/[id]/members tab). Admin-only.
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/server/current-user";
import { q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";
import { UsersClient } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.is_admin) redirect("/");

  const rows = q<{ id: number; name: string; username: string; active: number; is_admin: number; last_login: number | null; telegram_chat: string }>(
    "SELECT * FROM users ORDER BY is_admin DESC, name",
  );
  const users = rows.map((u) => ({
    ...u,
    projects: q<{ project_id: string; role: string; name: string }>(
      "SELECT m.project_id, m.role, p.name FROM members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=? ORDER BY p.name", u.id,
    ),
  }));

  return (
    <div className="picker">
      <div className="picker-top">
        <Link href="/">همه پروژه‌ها</Link>
      </div>
      <div className="page-head" style={{ padding: 0, border: 0 }}>
        <div className="head-title"><h1>کاربران</h1><span className="muted">{faNum(users.length)} کاربر</span></div>
      </div>
      <UsersClient currentUserId={user.id} initialUsers={users} />
    </div>
  );
}
