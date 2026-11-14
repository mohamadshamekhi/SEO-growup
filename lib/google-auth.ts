// Ported from hub/gsc.py's key_info()/save_key()/token(). Per the approved plan (Section 8),
// this swaps the hand-rolled JWT-assertion signing (which shelled out to system `openssl`
// because stdlib Python has no RS256 signer) for Node's built-in `crypto.sign` — no need for
// the official `googleapis` npm package either, since the actual API calls stay hand-rolled
// fetch() calls (ported 1:1 from gsc.ts/ga.ts), only the token acquisition changes mechanism.
// Same key file path (data/keys/gsc.json) and shape, so an existing Python-era key works as-is.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";
import { googleDispatcher } from "./google-proxy";

const KEY_PATH = path.join(DATA_DIR, "keys", "gsc.json");
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

type ServiceAccountKey = { type: string; client_email: string; private_key: string; token_uri: string; project_id?: string };

function readKey(): ServiceAccountKey {
  return JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
}

export function keyInfo(): { client_email: string; project_id: string } | { error: string } | null {
  if (!fs.existsSync(KEY_PATH)) return null;
  try {
    const k = readKey();
    return { client_email: k.client_email, project_id: k.project_id || "" };
  } catch {
    return { error: "فایل کلید نامعتبر است" };
  }
}

export function saveKey(text: string) {
  const k = JSON.parse(text);
  if (k.type !== "service_account" || !k.private_key || !k.client_email) throw new Error("این فایل کلید Service Account نیست");
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, JSON.stringify(k), { mode: 0o600 });
  tokenCache.clear();
  return keyInfo();
}

const tokenCache = new Map<string, { value: string; exp: number }>();

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function token(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && Date.now() / 1000 < cached.exp - 60) return cached.value;

  const k = readKey();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(Buffer.from(JSON.stringify({ iss: k.client_email, scope, aud: k.token_uri, iat: now, exp: now + 3600 })));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(k.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(k.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store", // this is a token exchange; Next's URL-keyed fetch cache must never serve a stale one
    ...googleDispatcher,
  } as RequestInit);
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const r = await res.json();
  tokenCache.set(scope, { value: r.access_token, exp: Date.now() / 1000 + (r.expires_in || 3600) });
  return r.access_token;
}
