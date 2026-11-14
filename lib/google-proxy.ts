// Google (googleapis.com) is network-blocked outright from this server's IP (even public,
// unauthenticated endpoints 403 with Google's own block page) — confirmed via direct curl.
// deb.debian.org/Playwright's CDN had mirror workarounds; Google does not. The only fix is
// routing just the Google calls through a non-Iran egress (a tinyproxy instance on another
// server). GOOGLE_PROXY_URL is optional — unset, Google calls go out directly as before.
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

const PROXY_URL = process.env.GOOGLE_PROXY_URL || "";

let agent: Dispatcher | undefined;
if (PROXY_URL) agent = new ProxyAgent(PROXY_URL);

// Node's global fetch runs on its own bundled undici build, which rejects a Dispatcher from
// the separately-installed `undici` npm package (version-internal handler mismatch: "invalid
// onRequestStart method"). Using this package's own fetch keeps dispatcher + fetch from the
// same undici build, so they're actually compatible. No proxy set -> plain global fetch.
export const googleFetch: typeof fetch = agent
  ? ((url, init) => undiciFetch(url as string, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>)
  : fetch;
