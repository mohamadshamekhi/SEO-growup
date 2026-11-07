import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { jobsState } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  return NextResponse.json(jobsState());
}
