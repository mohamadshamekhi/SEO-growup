// In-memory job queues, replacing Python's three `queue.Queue()` objects + `threading.Lock`.
// Node is single-threaded, so a real lock is unnecessary here — plain arrays plus async
// worker loops give the same three-lane separation (general / writes / competitor reads)
// without needing Redis or a queue library.
//
// IMPORTANT: this module's mutable state lives on `globalThis`, not as a plain module-level
// `const`. Next.js's Route Handlers run through its own bundled module graph, separate from
// the one server.ts's plain `tsx`-executed imports resolve to — so a normal module-level
// singleton silently ends up as two different objects, and API routes would never see jobs
// the scheduler/workers (started from server.ts) actually ran. Verified by hand: a plain
// module-level `state` showed 0 history entries from a route handler right after server.ts's
// own import of the same file pushed one. `globalThis` is the one thing both module
// instances actually share within the same OS process.
//
// Dispatch is HONEST about what's ported: "uptime" actually runs (lib/tools.ts's ping()).
// Every other job kind (audit/catalog/gsc/speed/watch/kwgap/prices/report/apply/undo/index/
// articles) records a real `runs` row with status='error' and a clear "not built yet"
// message — it never fakes success. Each of those lands with the phase that ports its
// module (Phase 5's module groups, or Phase 5c for apply/undo once adapters exist).
import { run, one } from "../db";
import { project } from "../projects";
import { ping } from "../tools";
import { pull as gscPull } from "../gsc";
import { pull as gaPull } from "../ga";
import { runSpeed } from "../pagespeed";

export type Job = { project: string; kind: string; auto?: boolean; ids?: number[]; user?: string; [k: string]: unknown };

export type Lane = "jobs" | "writeJobs" | "readJobs";

export type RunningSlot = (Job & { started: number; done: number; total: number; message: string }) | null;

type GlobalJobState = {
  lanes: Record<Lane, Job[]>;
  state: { current: RunningSlot; writing: RunningSlot; reading: RunningSlot; queued: Job[]; history: (Job & { finished: number; status: string })[] };
  workersStarted: Set<Lane>;
};

const g = globalThis as unknown as { __growthHubJobs?: GlobalJobState };

if (!g.__growthHubJobs) {
  g.__growthHubJobs = {
    lanes: { jobs: [], writeJobs: [], readJobs: [] },
    state: { current: null, writing: null, reading: null, queued: [], history: [] },
    workersStarted: new Set(),
  };
}

const shared = g.__growthHubJobs;
export const state = shared.state;
const lanes = shared.lanes;

const HISTORY_MAX = 30;

// Not yet ported from Python; each is added as its owning module lands.
const NOT_IMPLEMENTED = new Set(["audit", "catalog", "watch", "kwgap", "prices", "report", "apply", "undo", "index", "articles", "recheck"]);

function laneFor(kind: string): Lane {
  if (kind === "apply" || kind === "undo") return "writeJobs";
  if (kind === "kwgap") return "readJobs";
  return "jobs";
}

export function enqueue(job: Job): boolean {
  // Dedupe against anything already queued for the same (project, kind) — same spirit as
  // server.py's enqueue(), without the lock since nothing else can interleave here.
  if (state.queued.some((j) => j.project === job.project && j.kind === job.kind)) return false;
  state.queued.push(job);
  lanes[laneFor(job.kind)].push(job);
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(job: Job, progress: (done: number, total: number, message: string) => void): Promise<{ status: "ok" | "error"; summary?: unknown; error?: string }> {
  if (job.kind === "uptime") {
    const p = project(job.project);
    if (!p) return { status: "error", error: "پروژه پیدا نشد" };
    const r = await ping(p);
    return { status: "ok", summary: r };
  }
  if (job.kind === "gsc") {
    const p = project(job.project);
    if (!p) return { status: "error", error: "پروژه پیدا نشد" };
    try {
      const r = await gscPull(p);
      // keywords.track()/growth.measure()/funnel.measure_tests()/oos_propose() that the
      // Python scheduler also runs after a GSC pull are Phase 5b/5e — not run here yet.
      try { await gaPull(p); } catch { /* GA is optional; a GSC-only pull still counts as ok */ }
      return { status: "ok", summary: r };
    } catch (e) {
      return { status: "error", error: String((e as Error).message || e).slice(0, 500) };
    }
  }
  if (job.kind === "speed") {
    const p = project(job.project);
    if (!p) return { status: "error", error: "پروژه پیدا نشد" };
    try {
      const r = await runSpeed(p, progress);
      return { status: "ok", summary: r };
    } catch (e) {
      return { status: "error", error: String((e as Error).message || e).slice(0, 500) };
    }
  }
  if (NOT_IMPLEMENTED.has(job.kind)) {
    return { status: "error", error: `این نوع کار («${job.kind}») هنوز در نسخه Next.js پیاده نشده؛ منتظر فاز مربوطه بمانید.` };
  }
  void progress;
  return { status: "error", error: `نوع کار ناشناخته: ${job.kind}` };
}

export async function startWorker(lane: Lane, slot: "current" | "writing" | "reading") {
  // Guard against starting the same lane's loop twice — e.g. if server.ts's module ever got
  // re-evaluated (shouldn't happen under tsx, but globalThis-backed state makes this safe
  // to assert rather than silently run two competing consumers of the same lane).
  if (shared.workersStarted.has(lane)) return;
  shared.workersStarted.add(lane);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = lanes[lane].shift();
    if (!job) { await sleep(500); continue; }
    state.queued = state.queued.filter((j) => j !== job);
    const started = Date.now() / 1000;
    state[slot] = { ...job, started, done: 0, total: 0, message: "" };
    const rid = run("INSERT INTO runs(project_id, kind, started_at, status) VALUES (?,?,?, 'running')", job.project, job.kind, started).lastInsertRowid;
    try {
      const result = await runJob(job, (done, total, message) => {
        if (state[slot]) state[slot] = { ...(state[slot] as Job & { started: number }), done, total, message };
      });
      run("UPDATE runs SET finished_at=?, status=?, summary=?, error=? WHERE id=?",
        Date.now() / 1000, result.status, JSON.stringify(result.summary ?? {}), result.error ?? "", rid);
      state.history.unshift({ ...(state[slot] as Job), finished: Date.now() / 1000, status: result.status });
    } catch (e) {
      run("UPDATE runs SET finished_at=?, status='error', error=? WHERE id=?", Date.now() / 1000, String((e as Error).message || e).slice(0, 500), rid);
      state.history.unshift({ ...(state[slot] as Job), finished: Date.now() / 1000, status: "error" });
    } finally {
      if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
      state[slot] = null;
    }
  }
}

export function lastRun(pid: string, kind: string, okOnly = false) {
  return one(`SELECT * FROM runs WHERE project_id=? AND kind=? ${okOnly ? "AND status='ok'" : ""} ORDER BY id DESC LIMIT 1`, pid, kind);
}
