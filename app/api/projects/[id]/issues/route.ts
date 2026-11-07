import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { CHECKS } from "@/lib/checks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const status = req.nextUrl.searchParams.get("status") || "open";
  const rows = q<{ code: string; [k: string]: unknown }>(
    `SELECT * FROM issues WHERE project_id=? AND (?='all' OR status=?)
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code, url`,
    pid, status, status,
  );
  const out = rows.map((r) => {
    const c = CHECKS[r.code];
    return { ...r, label: c ? c[1] : r.code, fix: c ? c[2] : "" };
  });
  return NextResponse.json(out);
}
