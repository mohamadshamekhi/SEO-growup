// Google (googleapis.com) is network-blocked outright from this server's IP (even public,
// unauthenticated endpoints 403 with Google's own block page) — confirmed via direct curl.
// deb.debian.org/Playwright's CDN had mirror workarounds; Google does not. The only fix is
// routing just the Google calls through a non-Iran egress (a tinyproxy instance on another
// server). GOOGLE_PROXY_URL is optional — unset, Google calls go out directly as before.
import { ProxyAgent, type Dispatcher } from "undici";

const PROXY_URL = process.env.GOOGLE_PROXY_URL || "";

let agent: Dispatcher | undefined;
if (PROXY_URL) agent = new ProxyAgent(PROXY_URL);

// Spread this into any fetch() call that hits googleapis.com / accounts.google.com.
export const googleDispatcher: { dispatcher?: Dispatcher } = agent ? { dispatcher: agent } : {};
