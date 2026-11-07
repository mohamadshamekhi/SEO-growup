import type { NextConfig } from "next";

// cacheComponents/PPR are off on purpose: this app is almost entirely per-session, DB-backed
// dynamic content (auth, live job state, per-project data) — there's little to statically
// cache, and the strict prerendering rules those flags enforce fight that shape for no gain.
const nextConfig: NextConfig = {};

export default nextConfig;
