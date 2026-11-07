// In-memory job queues, replacing Python's three `queue.Queue()` objects + `threading.Lock`.
// Node is single-threaded, so a real lock is unnecessary here — plain arrays plus async
// worker loops give the same three-lane separation (general / writes / competitor reads)
// without needing Redis or a queue library. Real job dispatch lands in Phase 4; this is
// just the shape, wired up at boot so the architecture is provable in Phase 0.
export type Job = { project: string; kind: string; auto?: boolean; [k: string]: unknown };

export type Lane = "jobs" | "writeJobs" | "readJobs";

const lanes: Record<Lane, Job[]> = { jobs: [], writeJobs: [], readJobs: [] };

export type RunningSlot = (Job & { started: number; done: number; total: number; message: string }) | null;

export const state = {
  current: null as RunningSlot,
  writing: null as RunningSlot,
  reading: null as RunningSlot,
  queued: [] as Job[],
  history: [] as (Job & { finished: number })[],
};

const HISTORY_MAX = 30;

export function enqueue(job: Job) {
  const lane: Lane = job.kind === "apply" || job.kind === "undo" ? "writeJobs" : job.kind === "kwgap" ? "readJobs" : "jobs";
  // Dedupe against anything already queued for the same (project, kind) — same spirit as
  // server.py's enqueue(), without the lock since nothing else can interleave here.
  if (state.queued.some((j) => j.project === job.project && j.kind === job.kind)) return false;
  state.queued.push(job);
  lanes[lane].push(job);
  return true;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWorker(lane: Lane, slot: "current" | "writing" | "reading") {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = lanes[lane].shift();
    if (!job) { await sleep(500); continue; }
    state.queued = state.queued.filter((j) => j !== job);
    state[slot] = { ...job, started: Date.now(), done: 0, total: 0, message: "" };
    try {
      // Phase 4 wires real dispatch (crawl/catalog/gsc/... by job.kind) here.
      await sleep(10);
    } finally {
      state.history.unshift({ ...(state[slot] as Job), finished: Date.now() });
      if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
      state[slot] = null;
    }
  }
}
