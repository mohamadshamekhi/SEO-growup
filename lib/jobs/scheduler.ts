// Replaces hub/schedule.py + server.py's scheduler() loop. Real per-project due-time logic
// (reading the `schedule:<pid>` JSON blob from `settings`, same as Python) lands in Phase 4
// alongside the real worker dispatch; this stub proves the 60s-poll shape at boot.
import { q } from "../db";

const POLL_MS = 60_000;

export function startScheduler() {
  const tick = () => {
    try {
      const projects = q<{ id: string }>("SELECT id FROM projects");
      // Phase 4: for each project, check schedule.isDue() per job kind and enqueue().
      void projects;
    } catch (err) {
      console.error("[scheduler]", err);
    }
  };
  tick();
  return setInterval(tick, POLL_MS);
}
