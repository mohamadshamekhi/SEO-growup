import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  return NextResponse.json(q(
    "SELECT id, url, type, after, ts, user_name, undone FROM applied WHERE project_id=? ORDER BY id DESC LIMIT 200", pid,
  ));
}
