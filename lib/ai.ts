// Client for the self-hosted AI gateway, used in place of the external Claude-Code-CLI
// agent-poll loop for writing content directly from this server process. Only the content
// writer (lib/content.ts's autoWrite) uses this for now — the other writer_requests "what"
// kinds (fixes/ideas, and the kw/serp/cro/etc. agent/* endpoints) still assume an external
// agent and are unchanged.
const GATEWAY_URL = process.env.AI_GATEWAY_URL || "http://194.146.123.114:51091/v1/chat";
const GATEWAY_TOKEN = process.env.AI_GATEWAY_TOKEN || "";
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL || "haiku";

export class AIGatewayError extends Error {}

type GatewayResponse = { result?: string };

export async function askAI(prompt: string, model = GATEWAY_MODEL): Promise<string> {
  if (!GATEWAY_TOKEN) throw new AIGatewayError("AI_GATEWAY_TOKEN در .env تنظیم نشده");
  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new AIGatewayError(`اتصال به gateway برقرار نشد: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AIGatewayError(`gateway خطا داد (${res.status})`);
  const data = await res.json().catch(() => null) as GatewayResponse | null;
  if (!data?.result) throw new AIGatewayError("gateway خروجی متنی برنگرداند");
  return data.result;
}

/** Models sometimes wrap JSON in a ```json fence despite being asked not to; strip it before parsing. */
export function parseJsonLoose(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}
