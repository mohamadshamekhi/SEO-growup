import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { visibleProjects } from "@/lib/auth";
import { jobsState } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const visible = new Set(visibleProjects(gate.user).map((p) => p.id));
  return NextResponse.json(jobsState(visible));
}
