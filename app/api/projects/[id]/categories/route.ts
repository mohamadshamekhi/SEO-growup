import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import * as adapters from "@/lib/adapters";
import { upsertFix } from "@/lib/fix-upsert";
import { one } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

function steve(pid: string): adapters.Steve {
  const cfg = adapters.config(pid);
  if (!cfg || cfg.type !== "steve") throw new Error("تغییر دسته فقط برای سایت متصل استیو پیاده شده است.");
  return adapters.client(pid) as adapters.Steve;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  try { return NextResponse.json(await steve(pid).categories()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

/** {urls[], category_id}: moves the products to that category on the live site (each undoable from history). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { urls?: string[]; category_id?: string; category_name?: string };
  const urls = (b.urls || []).filter((u) => typeof u === "string" && u.includes("/product/")).slice(0, 200);
  const cat = String(b.category_id || "").trim();
  if (!urls.length || !cat) return NextResponse.json({ error: "محصول و دسته را انتخاب کنید" }, { status: 400 });
  try { steve(pid); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const results: { url: string; ok: boolean; error?: string }[] = [];
  for (const url of urls) {
    const fid = upsertFix(pid, url, "category", "", cat, `انتقال به دسته «${b.category_name || cat}»`, "approved");
    await adapters.applyFixes(p, [fid], gate.user.name);
    const st = one<{ status: string; apply_error: string }>("SELECT status, apply_error FROM fixes WHERE id=?", fid)!;
    results.push(st.status === "done" ? { url, ok: true } : { url, ok: false, error: st.apply_error || "ناموفق" });
  }
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ results });
}
