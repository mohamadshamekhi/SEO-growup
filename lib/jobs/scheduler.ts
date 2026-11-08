// Replaces server.py's scheduler() loop. Every 60s, for each project and each job kind in
// its schedule, checks isDue() and enqueues — real due-time logic (lib/schedule.ts), even
// though most job kinds still just record a "not implemented" error once dispatched (see
// lib/jobs/queues.ts). This is deliberate: the scheduler itself, and the runs history it
// produces, should be real and inspectable now, not faked until Phase 5 modules land.
//
// policy.tick() also runs every tick here (same as Python) — real, since lib/policy.ts is
// fully ported. autorun_step()/keywords.next_step() (the content-writing state machine) are
// Phase 5e and not wired in yet.
import { projects } from "../projects";
import { get, isDue, lastTimes, type JobKey } from "../schedule";
import { enqueue } from "./queues";
import { tick as policyTick, AUTO_USER } from "../policy";

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
      const ready = policyTick(p.id, now);
      if (ready.length) enqueue({ project: p.id, kind: "apply", ids: ready, user: AUTO_USER });
    } catch (err) {
      console.error(`[scheduler] ${p.id}:`, err);
    }
  }
}

export function startScheduler() {
  tick();
  return setInterval(tick, POLL_MS);
}
