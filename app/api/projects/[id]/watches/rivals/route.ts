import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { findRivals } from "@/lib/rivals";

export const dynamic = "force-dynamic";

/** Suggests competitor pages for one of our URLs from already-collected data (read-only). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const url = String(req.nextUrl.searchParams.get("url") || "").trim();
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "آدرس صفحه را کامل با https وارد کنید" }, { status: 400 });
  return NextResponse.json(findRivals(p, url));
}
