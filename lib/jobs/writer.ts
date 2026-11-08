// Replaces server.py's global `writer` dict — the single-writer-slot invariant ensuring
// only one Claude Code writing job runs at a time across the whole process (local subprocess
// or, per the approved plan, a remote agent.py polling /api/agent/poll — the primary path
// here, since it doesn't require the `claude` CLI on this machine). What a writer actually
// *does* (hub/content.py's writer_command, the content/keywords/funnel/etc. modules it calls
// into) is Phase 5; this is just the slot/handoff plumbing, exercised end-to-end by
// /api/agent/poll + /api/agent/done against real `writer_requests` rows.
//
// State lives on `globalThis`, same reason as lib/jobs/queues.ts: a plain module-level
// singleton is NOT actually shared between server.ts's direct import and the separate module
// instance Next.js's Route Handler bundle resolves the same file to.
export type WriterState = { running: boolean; project: string | null; what: string | null; started: number | null; finished: number | null; code: number | null; log: string };

const g = globalThis as unknown as { __growthHubWriter?: WriterState };
if (!g.__growthHubWriter) {
  g.__growthHubWriter = { running: false, project: null, what: null, started: null, finished: null, code: null, log: "" };
}
const writer = g.__growthHubWriter;

export function tryAcquire(project: string, what: string) {
  if (writer.running) return false;
  Object.assign(writer, { running: true, project, what, started: Date.now() / 1000, finished: null, code: null, log: "" });
  return true;
}

export function release(code: number | null = null, log = "") {
  Object.assign(writer, { running: false, finished: Date.now() / 1000, code, log: log.slice(-3000) });
}

export function writerState(): Readonly<WriterState> {
  return writer;
}
