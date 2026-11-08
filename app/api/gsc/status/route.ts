import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { one, q } from "@/lib/db";
import { guessProperty, sites } from "@/lib/gsc";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });

  let site: string[];
  try { site = await sites(); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const projects = q<{ id: string; name: string; domain: string; gsc_property: string }>("SELECT id, name, domain, gsc_property FROM projects");
  const out = projects.map((x) => {
    const guess = guessProperty(x.domain, site);
    const property = site.includes(x.gsc_property) ? x.gsc_property : guess;
    return {
      id: x.id, name: x.name, domain: x.domain, property,
      connected: site.includes(x.gsc_property) || !!guess,
      days: one<{ n: number }>("SELECT COUNT(*) n FROM gsc_daily WHERE project_id=?", x.id)!.n,
    };
  });
  return NextResponse.json(out);
}
