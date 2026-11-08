import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { compare } from "@/lib/tools";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const mine = String(b.mine || "").trim();
  const others = ((b.others as string[]) || []).map((x) => String(x).trim()).filter((x) => x.startsWith("http"));
  if (!mine.startsWith("http") || !others.length) return NextResponse.json({ error: "آدرس صفحه خودتان و حداقل یک رقیب لازم است" }, { status: 400 });
  try {
    const result = await compare(pid, mine, others);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
