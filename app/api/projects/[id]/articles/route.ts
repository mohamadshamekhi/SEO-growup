import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { config } from "@/lib/adapters";
import { one } from "@/lib/db";
import { siteArticles } from "@/lib/planner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const synced = one<{ s: number | null }>("SELECT MAX(synced) s FROM site_articles WHERE project_id=?", pid);
  return NextResponse.json({ items: siteArticles(pid), synced: synced?.s ?? null, has_api: !!config(pid) });
}
