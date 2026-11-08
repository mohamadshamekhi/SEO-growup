// Ported from hub/db.py's project()/projects() — decodes the JSON columns (competitors,
// keywords, settings) the same way, and keeps the "Steve always first" ordering.
import { one, q } from "./db";

const JSON_FIELDS = ["competitors", "keywords", "settings"] as const;

export type ProjectRow = {
  id: string; name: string; domain: string; color: string; logo_url: string; sitemap: string;
  max_pages: number; gsc_property: string; created_at: number;
  competitors: unknown[]; keywords: unknown[]; settings: Record<string, unknown>;
};

type RawProjectRow = Omit<ProjectRow, "competitors" | "keywords" | "settings"> & {
  competitors: string; keywords: string; settings: string;
};

function decode(row: RawProjectRow): ProjectRow {
  const out = { ...row } as unknown as ProjectRow;
  for (const f of JSON_FIELDS) {
    try { (out as unknown as Record<string, unknown>)[f] = JSON.parse((row as unknown as Record<string, string>)[f] || (f === "settings" ? "{}" : "[]")); }
    catch { (out as unknown as Record<string, unknown>)[f] = f === "settings" ? {} : []; }
  }
  return out;
}

export function project(id: string): ProjectRow | undefined {
  const row = one<RawProjectRow>("SELECT * FROM projects WHERE id=?", id);
  return row ? decode(row) : undefined;
}

export function projects(): ProjectRow[] {
  return q<RawProjectRow>("SELECT * FROM projects ORDER BY id='stevemobile' DESC, created_at").map(decode);
}

export function slugify(s: string): string {
  const stripped = s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(".")[0];
  const out = stripped.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "project";
}

export type CleanedProject = Partial<{
  name: string; domain: string; color: string; logo_url: string; sitemap: string; gsc_property: string;
  max_pages: number; competitors: string; keywords: string; settings: string;
}>;

/** Ported from server.py's clean_project(). Validates and narrows a request body to the
 * columns `projects` actually has; raises on anything invalid rather than silently dropping
 * or coercing it. */
export function cleanProject(b: Record<string, unknown>, partial = false): CleanedProject {
  const out: CleanedProject = {};
  if ("name" in b || !partial) out.name = String(b.name ?? "").trim().slice(0, 80);
  if ("domain" in b || !partial) {
    const d = String(b.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error("دامنه نامعتبر است (مثل example.com)");
    out.domain = d;
  }
  if (!partial && !out.name) throw new Error("نام لازم است");
  for (const k of ["color", "logo_url", "sitemap", "gsc_property"] as const) {
    if (k in b) out[k] = String(b[k] ?? "").trim().slice(0, 500);
  }
  if (out.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(out.color)) out.color = "#5a4fcf";
  for (const k of ["logo_url", "sitemap"] as const) {
    if (out[k] && !out[k]!.startsWith("https://") && !out[k]!.startsWith("http://")) throw new Error(`${k} باید با http شروع شود`);
  }
  if ("max_pages" in b) out.max_pages = Math.max(5, Math.min(2000, Number(b.max_pages) || 500));
  for (const k of ["competitors", "keywords"] as const) {
    if (k in b) {
      const raw = b[k];
      const list = Array.isArray(raw) ? raw : String(raw ?? "").split("\n");
      out[k] = JSON.stringify(list.map((x) => String(x).trim()).filter(Boolean).slice(0, 200));
    }
  }
  if ("settings" in b) out.settings = JSON.stringify(b.settings && typeof b.settings === "object" && !Array.isArray(b.settings) ? b.settings : {});
  return out;
}
