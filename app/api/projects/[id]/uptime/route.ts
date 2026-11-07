import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { uptimeStats } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const hours = Number(req.nextUrl.searchParams.get("hours")) || 168;
  const rows = q<{ ts: number; status: number; ms: number }>(
    "SELECT ts, status, ms FROM uptime WHERE project_id=? AND ts>=? ORDER BY ts", pid, Date.now() / 1000 - hours * 3600,
  );
  return NextResponse.json({ rows, day: uptimeStats(pid, 24), week: uptimeStats(pid, 168), month: uptimeStats(pid, 720) });
}
