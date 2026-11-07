// Mirrors server.py's /api/auth/state health-check target (used by the existing Dockerfile
// HEALTHCHECK). Queries the DB to prove the Phase 0 slice end-to-end: Next.js route handler
// -> lib/db.ts -> the real hub.db file.
import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = one<{ n: number }>("SELECT COUNT(*) as n FROM projects");
  return NextResponse.json({ ok: true, projects: row?.n ?? 0 });
}
