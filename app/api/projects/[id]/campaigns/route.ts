import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { listing, create, DATE_RE, type CampaignInput, type CampaignType } from "@/lib/campaigns";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const TYPES: CampaignType[] = ["seasonal", "content", "paid"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  return NextResponse.json(listing(pid));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({})) as Partial<CampaignInput>;
  const name = String(body.name || "").trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: "نام کمپین لازم است" }, { status: 400 });
  if (!TYPES.includes(body.type as CampaignType)) return NextResponse.json({ error: "نوع کمپین نامعتبر است" }, { status: 400 });
  for (const d of [body.start_date, body.end_date]) if (d && !DATE_RE.test(d)) return NextResponse.json({ error: "تاریخ مثل ۱۴۰۵/۰۸/۲۰" }, { status: 400 });

  const id = create(pid, gate.user.name, { ...body, name, type: body.type as CampaignType });
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ id });
}
