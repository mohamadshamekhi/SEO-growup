import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { undoCandidates } from "@/lib/policy";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const [ids, skipped] = undoCandidates(pid, body.type || undefined, body.day || undefined);
  if (body.preview || !ids.length) return NextResponse.json({ count: ids.length, skipped });
  const queued = enqueue({ project: pid, kind: "undo", ids });
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ count: ids.length, skipped, queued });
}
