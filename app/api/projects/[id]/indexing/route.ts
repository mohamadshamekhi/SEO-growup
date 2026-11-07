import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const rows = q("SELECT url, verdict, coverage, last_crawl, canonical, ts FROM index_status WHERE project_id=? ORDER BY verdict='PASS', ts DESC LIMIT 1000", pid);
  const run = one<{ id: number; summary: string; [k: string]: unknown }>(
    "SELECT * FROM runs WHERE project_id=? AND kind='index' AND status='ok' ORDER BY id DESC LIMIT 1", pid,
  );
  const total = one<{ n: number }>("SELECT COUNT(*) n FROM catalog WHERE project_id=?", pid)!.n + 1;
  return NextResponse.json({ rows, run: run ? { ...run, summary: JSON.parse(run.summary || "{}") } : null, total });
}
