import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { list, test, type ConnName } from "@/lib/connections";
import { setProperty as setGaProperty, pull as gaPull, saveError as gaSaveError } from "@/lib/ga";
import { run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const NAMES: ConnName[] = ["site", "site_api", "google_key", "gsc", "ga", "ai", "telegram", "pagespeed"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json(list(p));
}

/** {test: name} runs a live test; {ga: "123"} / {gsc: "sc-domain:..."} saves a property (GA is then pulled right away). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const b = await req.json().catch(() => ({})) as { test?: ConnName; ga?: string; gsc?: string };
  const gate = requireProjectAccess(req, pid, b.test ? "view" : "edit");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });

  if (b.test) {
    if (!NAMES.includes(b.test)) return NextResponse.json({ error: "اتصال نامعتبر" }, { status: 400 });
    return NextResponse.json(await test(p, b.test));
  }
  try {
    if (typeof b.ga === "string") {
      setGaProperty(pid, b.ga);
      let pulled: number | null = null, message = "ذخیره شد.";
      if (b.ga.trim()) {
        try { pulled = await gaPull(p); message = `ذخیره و دریافت شد؛ داده ${pulled ?? 0} صفحه خوانده شد.`; }
        catch (e) { gaSaveError(pid, (e as Error).message); message = `ذخیره شد ولی دریافت خطا داد: ${(e as Error).message}`; }
      }
      logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
      return NextResponse.json({ ok: pulled !== null || !b.ga.trim(), message });
    }
    if (typeof b.gsc === "string") {
      const v = b.gsc.trim();
      if (v && !/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+\/)$/i.test(v)) return NextResponse.json({ error: "property باید مثل sc-domain:example.com یا https://example.com/ باشد" }, { status: 400 });
      run("UPDATE projects SET gsc_property=? WHERE id=?", v, pid);
      logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
      return NextResponse.json({ ok: true, message: v ? "ذخیره شد." : "خالی شد؛ property از روی دامنه حدس زده می‌شود." });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
}
