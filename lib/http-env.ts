// Ported from server.py's module-level constants (HUB_HTTPS/HUB_PROXY/HUB_HOSTS env vars,
// cookie naming). Browsers share cookies across ports, so local instances need distinct
// cookie names or they log each other out — same reasoning as the Python original.
export const HTTPS = process.env.HUB_HTTPS === "1";
export const PROXY = process.env.HUB_PROXY === "1";
export const EXTRA_HOSTS = new Set((process.env.HUB_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
export const PORT = Number(process.env.HUB_PORT) || 4500;
export const COOKIE = HTTPS ? "__Host-hub_session" : `hub_session_${PORT}`;
