// Ported from server.py's combined GET .../funnel. growth.impact_summary() (hub/growth.py,
// not fully ported) is not built yet — returned as empty so the frontend can tell "not built
// yet" from "really empty".
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { config } from "@/lib/adapters";
import { rows, croList, tests, feedState, oosList, paidOos, restock, setMargin } from "@/lib/funnel";
import { rollbacks, batches } from "@/lib/policy";
import { funnel as gaFunnel, getProperty, hasCartEvents, channels, tracking } from "@/lib/ga";
import { sales } from "@/lib/growth";
import { rows as priceRows } from "@/lib/prices";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  return NextResponse.json({
    rows: rows(pid), cro: croList(pid), tests: tests(pid), rollbacks: rollbacks(pid), feed: feedState(pid),
    connected: !!config(pid),
    ga: { connected: !!Object.keys(gaFunnel(pid)).length, property: !!getProperty(pid), carts: hasCartEvents(pid) },
    sales: !!Object.keys(sales(pid)).length,
    impact: [], // Phase 5e (hub/growth.py's impact_summary)
    channels: channels(pid), tracking: tracking(pid),
    alternatives: oosList(pid), paid_oos: paidOos(pid), restock: restock(pid),
    prices: priceRows(pid),
    batches: batches(pid),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "margin") { setMargin(pid, String(body.url || ""), body.level); logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "عملیات نامعتبر" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
