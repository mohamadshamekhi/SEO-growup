// Ported from hub/catalog.py's rows() — the writing side (crawling products/articles into
// this table, building SEO fix proposals) is Phase 5; this just reads what's already there.
import { q } from "./db";

export type CatalogItem = {
  url: string; kind: "product" | "article"; name: string; brand: string; description: string;
  images: string[]; available: number | null; price: string; currency: string; condition: string; links: string[];
  [k: string]: unknown;
};

export function catalogRows(pid: string, kind?: "product" | "article"): CatalogItem[] {
  const rows = kind
    ? q<{ data: string }>("SELECT data FROM catalog WHERE project_id=? AND kind=?", pid, kind)
    : q<{ data: string }>("SELECT data FROM catalog WHERE project_id=?", pid);
  return rows.map((r) => JSON.parse(r.data));
}
