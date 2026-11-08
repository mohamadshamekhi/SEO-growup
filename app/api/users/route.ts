import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { q, run } from "@/lib/db";
import { createUser, publicUser, ROLES, type User } from "@/lib/auth";
import { project } from "@/lib/projects";

export const dynamic = "force-dynamic";

function requireAdmin(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate;
  if (!gate.user.is_admin) return { response: NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 }) };
  return gate;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if ("response" in gate) return gate.response;
  const rows = q<User>("SELECT * FROM users ORDER BY is_admin DESC, name");
  const out = rows.map((u) => ({
    ...publicUser(u),
    projects: q("SELECT m.project_id, m.role, p.name FROM members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=? ORDER BY p.name", u.id),
  }));
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  try {
    const uid = createUser(b.name, b.username, b.password, !!b.is_admin);
    for (const x of (b.projects as { project?: string; role?: string }[]) || []) {
      if (x.project && project(String(x.project)) && (ROLES as readonly string[]).includes(String(x.role))) {
        run("INSERT OR REPLACE INTO members VALUES (?,?,?)", uid, x.project, x.role);
      }
    }
    return NextResponse.json({ id: uid });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
