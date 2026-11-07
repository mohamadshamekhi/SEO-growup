import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  return NextResponse.json(q(
    "SELECT id, name FROM users WHERE active=1 AND (is_admin=1 OR id IN (SELECT user_id FROM members WHERE project_id=? AND role='editor')) ORDER BY name",
    pid,
  ));
}
