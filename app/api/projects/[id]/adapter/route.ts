import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { client, publicConfig, removeConfig, saveConfig } from "@/lib/adapters";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  return NextResponse.json({ adapter: publicConfig(pid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  try {
    saveConfig(pid, body.type || "steve", body.base_url, body.token);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    await client(pid).test();
  } catch (e) {
    removeConfig(pid);
    return NextResponse.json({ error: `اتصال برقرار نشد: ${String((e as Error).message).slice(0, 160)}` }, { status: 400 });
  }
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ adapter: publicConfig(pid) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  removeConfig(pid);
  logActivity(pid, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ adapter: null });
}
