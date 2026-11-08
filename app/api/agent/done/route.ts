import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { one, run } from "@/lib/db";
import { release } from "@/lib/jobs/writer";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const r = one<{ project_id: string }>("SELECT project_id FROM writer_requests WHERE id=?", id);
  run("UPDATE writer_requests SET status='done' WHERE id=?", id);
  if (r) {
    run(
      "UPDATE content SET status='queued', note='نوشتن کامل نشد؛ دوباره تلاش کنید.', updated=? WHERE project_id=? AND status='writing'",
      Date.now() / 1000, r.project_id,
    );
  }
  release(body.code ?? null, String(body.log || ""));
  return NextResponse.json({ ok: true });
}
