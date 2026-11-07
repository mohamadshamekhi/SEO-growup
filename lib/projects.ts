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
