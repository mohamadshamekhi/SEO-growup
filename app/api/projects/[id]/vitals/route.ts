import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { getSetting, q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const rows = q("SELECT * FROM vitals WHERE project_id=? ORDER BY ts DESC LIMIT 200", pid);
  return NextResponse.json({ rows, has_key: !!getSetting("pagespeed_key", "") });
}
