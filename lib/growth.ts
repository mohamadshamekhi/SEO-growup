// Partial port of hub/growth.py — only the two read-only helpers lib/funnel.ts needs
// (sales() reads what the last GSC/sales pull already stored; lessons() reads the impact
// table). The rest of growth.py (pull_sales, refresh_candidates, FAQ generation, Instagram
// feedback, weekly digest) is NOT ported yet — tracked separately.
import { getSetting, q } from "./db";

export function sales(pid: string): Record<string, { name: string; units: number }> {
  return getSetting<{ products?: Record<string, { name: string; units: number }> }>(`sales:${pid}`, {}).products || {};
}

type ImpactRow = { type: string; verdict: string; position_before: number | null; position_after: number | null; clicks_before: number | null; clicks_after: number | null };

export function lessons(pid: string, n = 12) {
  return q<ImpactRow>("SELECT * FROM impact WHERE project_id=? AND verdict!='little_data' ORDER BY measured DESC LIMIT ?", pid, n).map((r) => ({
    change: r.type, verdict: r.verdict, position: [r.position_before, r.position_after], clicks: [r.clicks_before, r.clicks_after],
  }));
}
