// Exposes the in-memory queue state (lib/jobs/queues.ts) + recent `runs` rows, filtered to
// this project, so the UI can show "what's running right now / what just ran" instead of
// jobs silently happening with no visible trace.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { state } from "@/lib/jobs/queues";

export const dynamic = "force-dynamic";

type RunRow = { id: number; kind: string; started_at: number; finished_at: number | null; status: string; error: string };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const mine = (slot: typeof state.current) => (slot && slot.project === pid ? slot : null);
  const runs = q<RunRow>(
    "SELECT id, kind, started_at, finished_at, status, error FROM runs WHERE project_id=? ORDER BY id DESC LIMIT 20",
    pid,
  );

  return NextResponse.json({
    current: mine(state.current),
    writing: mine(state.writing),
    reading: mine(state.reading),
    queued: state.queued.filter((j) => j.project === pid),
    history: state.history.filter((j) => j.project === pid).slice(0, 20),
    runs,
  });
}
