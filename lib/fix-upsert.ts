// fixes is UNIQUE(project_id, url, type): a page can only have one row per fix type. One-click
// actions (issue auto-fix, search-console optimize, CRO rewrite) may hit a page that already
// has a row (an earlier done/pending fix), so they write through this upsert instead of INSERT.
import { one, run, now } from "./db";

export function upsertFix(pid: string, url: string, type: string, current: string, proposed: string, detail: string, status: "pending" | "approved", baseHash = ""): number {
  const t = now();
  run(
    `INSERT INTO fixes(project_id,url,type,severity,current,proposed,detail,status,base_hash,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(project_id,url,type) DO UPDATE SET current=excluded.current, proposed=excluded.proposed, detail=excluded.detail,
       status=excluded.status, base_hash=excluded.base_hash, apply_error='', updated=excluded.updated`,
    pid, url, type, "info", current, proposed, detail, status, baseHash, t, t,
  );
  return one<{ id: number }>("SELECT id FROM fixes WHERE project_id=? AND url=? AND type=?", pid, url, type)!.id;
}
