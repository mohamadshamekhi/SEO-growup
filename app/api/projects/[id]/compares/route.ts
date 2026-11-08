import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const rows = q<{ id: number; ts: number; data: string }>("SELECT id, ts, data FROM compares WHERE project_id=? ORDER BY id DESC LIMIT 30", pid);
  return NextResponse.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data) })));
}
