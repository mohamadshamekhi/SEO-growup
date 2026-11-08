import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { GUIDE, COVERAGE } from "@/lib/guide";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  return NextResponse.json({ guide: GUIDE, coverage: COVERAGE });
}
