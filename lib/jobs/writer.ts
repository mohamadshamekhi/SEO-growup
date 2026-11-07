// Replaces server.py's global `writer` dict — the single-writer-slot invariant ensuring
// only one `claude -p` (or one remote-agent job) runs at a time across the whole process.
// Per the approved plan, the remote-agent poll pattern (agent.py talking to /api/agent/*)
// is primary in the Next.js version; this local-spawn path stays behind HUB_LOCAL_WRITER
// for dev only. Phase 4 wires the actual child_process.spawn + 30-minute timeout.
type WriterState = { running: boolean; project: string | null; what: string | null; started: number | null; log: string };

const writer: WriterState = { running: false, project: null, what: null, started: null, log: "" };

export function tryAcquire(project: string, what: string) {
  if (writer.running) return false;
  writer.running = true;
  writer.project = project;
  writer.what = what;
  writer.started = Date.now();
  writer.log = "";
  return true;
}

export function release() {
  writer.running = false;
  writer.project = null;
  writer.what = null;
  writer.started = null;
}

export function writerState(): Readonly<WriterState> {
  return writer;
}
