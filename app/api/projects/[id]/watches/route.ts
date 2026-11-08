import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { addWatch } from "@/lib/extras";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const rows = q<{ id: number; mine: string; others: string; changes: string; ts: number }>(
    "SELECT id, mine, others, changes, ts FROM watches WHERE project_id=? ORDER BY id DESC", pid,
  );
  return NextResponse.json(rows.map((r) => ({ ...r, others: JSON.parse(r.others), changes: JSON.parse(r.changes) })));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const others = ((b.others as string[]) || []).map((x) => String(x).trim()).filter((x) => x.startsWith("http")).slice(0, 5);
  const mine = String(b.mine || "");
  if (!mine.startsWith("http") || !others.length) return NextResponse.json({ error: "آدرس صفحه خودتان و حداقل یک رقیب لازم است" }, { status: 400 });
  try {
    const id = await addWatch(pid, mine.trim(), others);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
