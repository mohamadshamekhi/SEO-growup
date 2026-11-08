// Ported from server.py's agent_route() bearer-token check — deliberately a separate auth
// system from the session/cookie one: a leaked agent token reaches only the writing queue
// (/api/agent/*), nothing else in the panel.
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { one, run } from "./db";

export type AgentToken = { id: number; name: string; token_hash: string; created: number; last_seen: number | null };

export function requireAgentToken(req: NextRequest): { token: AgentToken } | { response: NextResponse } {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return { response: NextResponse.json({ error: "توکن نامعتبر است" }, { status: 401 }) };
  const hash = crypto.createHash("sha256").update(h.slice(7)).digest("hex");
  const token = one<AgentToken>("SELECT * FROM agent_tokens WHERE token_hash=?", hash);
  if (!token) return { response: NextResponse.json({ error: "توکن نامعتبر است" }, { status: 401 }) };
  run("UPDATE agent_tokens SET last_seen=? WHERE id=?", Date.now() / 1000, token.id);
  return { token };
}
