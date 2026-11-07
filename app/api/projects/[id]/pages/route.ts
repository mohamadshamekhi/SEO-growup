import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const run = one<{ id: number; started_at: number }>(
    "SELECT id, started_at FROM runs WHERE project_id=? AND kind='audit' AND status='ok' ORDER BY id DESC LIMIT 1", pid,
  );
  const rows = run
    ? q<{ jsonld: string; [k: string]: unknown }>("SELECT * FROM pages WHERE run_id=? ORDER BY issues DESC, url", run.id)
      .map((r) => ({ ...r, jsonld: JSON.parse(r.jsonld || "[]") }))
    : [];
  return NextResponse.json({ run: run ?? null, pages: rows });
}
