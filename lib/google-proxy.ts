// Several outbound destinations are network-blocked outright from this server's IP: Google
// (googleapis.com, even public unauthenticated endpoints — confirmed via direct curl) and
// Telegram (api.telegram.org — officially blocked in Iran). deb.debian.org/Playwright's CDN
// had mirror workarounds; these don't. The fix is routing just those calls through a non-Iran
// egress (a tinyproxy instance on another server). EGRESS_PROXY_URL is optional — unset,
// calls go out directly as before.
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

const PROXY_URL = process.env.EGRESS_PROXY_URL || process.env.GOOGLE_PROXY_URL || "";

let agent: Dispatcher | undefined;
if (PROXY_URL) agent = new ProxyAgent(PROXY_URL);

// Node's global fetch runs on its own bundled undici build, which rejects a Dispatcher from
// the separately-installed `undici` npm package (version-internal handler mismatch: "invalid
// onRequestStart method"). Using this package's own fetch keeps dispatcher + fetch from the
// same undici build, so they're actually compatible. No proxy set -> plain global fetch.
export const proxiedFetch: typeof fetch = agent
  ? ((url, init) => undiciFetch(url as string, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>)
  : fetch;

// Back-compat name (lib/google-auth.ts, gsc.ts, ga.ts, extras.ts, pagespeed.ts).
export const googleFetch = proxiedFetch;
