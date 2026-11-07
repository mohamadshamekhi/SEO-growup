// GET only for Phase 2 (read-only); POST (creating a task) is a mutation and lands in
// Phase 3 alongside the rest of the write-side routes. keywords.task_help() (the
// context-specific help text attached to auto-created tasks) is Phase 5b — stubbed as null
// here so the shape matches without crashing the UI.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const rows = q<{ id: number; [k: string]: unknown }>(
    `SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=? ORDER BY t.status='done', t.due='', t.due, t.id DESC LIMIT 300`,
    pid,
  );
  const out = rows.map((r) => ({
    ...r,
    comments: q("SELECT user_name, body, ts FROM comments WHERE task_id=? ORDER BY id", r.id),
    help: null,
  }));
  return NextResponse.json(out);
}
