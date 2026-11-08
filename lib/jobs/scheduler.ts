// Replaces server.py's scheduler() loop. Every 60s, for each project and each job kind in
// its schedule, checks isDue() and enqueues — real due-time logic (lib/schedule.ts), even
// though most job kinds still just record a "not implemented" error once dispatched (see
// lib/jobs/queues.ts). This is deliberate: the scheduler itself, and the runs history it
// produces, should be real and inspectable now, not faked until Phase 5 modules land.
import { projects } from "../projects";
import { get, isDue, lastTimes, type JobKey } from "../schedule";
import { enqueue } from "./queues";

const POLL_MS = 60_000;

function tick() {
  const now = Date.now() / 1000;
  for (const p of projects()) {
    try {
      const jobs = get(p);
      const last = lastTimes(p.id);
      for (const key of Object.keys(jobs) as JobKey[]) {
        if (isDue(jobs[key], last[key], now)) enqueue({ project: p.id, kind: key, auto: true });
      }
    } catch (err) {
      console.error(`[scheduler] ${p.id}:`, err);
    }
  }
}

export function startScheduler() {
  tick();
  return setInterval(tick, POLL_MS);
}
