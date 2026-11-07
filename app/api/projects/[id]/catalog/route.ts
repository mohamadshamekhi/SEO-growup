import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q } from "@/lib/db";
import { catalogRows, type CatalogItem } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const items = catalogRows(pid).map((i: CatalogItem) => {
    const { links: _links, description, ...rest } = i;
    void _links;
    return { ...rest, description: (description || "").slice(0, 200) };
  });
  const lastRun = one<{ id: number; started_at: number; status: string }>(
    "SELECT * FROM runs WHERE project_id=? AND kind='catalog' ORDER BY id DESC LIMIT 1", pid,
  );
  const states = q<{ url: string; type: string; status: string; proposed: string }>(
    "SELECT url, type, status, proposed FROM fixes WHERE project_id=?", pid,
  );
  return NextResponse.json({ items, run: lastRun ?? null, states });
}
