// Ported from server.py's fixexport. Same formula-injection guard (a leading =/+/-/@ gets a
// leading quote so a spreadsheet never executes cell text as a formula) and the same UTF-8
// BOM prefix so Excel opens Persian text correctly.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { FIX_LABEL } from "@/lib/fix-labels";

export const dynamic = "force-dynamic";

function csvField(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  const needsQuote = /[",\n]/.test(safe);
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const rows = q<{ type: string; url: string; current: string; proposed: string }>(
    "SELECT type, url, current, proposed FROM fixes WHERE project_id=? AND status='approved' ORDER BY type, url", pid,
  );
  const lines = ["نوع,آدرس,مقدار فعلی,مقدار پیشنهادی"];
  for (const r of rows) lines.push([FIX_LABEL[r.type] || r.type, r.url, r.current, r.proposed].map(csvField).join(","));
  return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}
