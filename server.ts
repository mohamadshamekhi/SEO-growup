// Custom Node server wrapping Next.js's request handler. This is the architectural core
// the plan calls for: the scheduler loop, job-queue workers, and the single-writer-slot
// invariant for `claude -p` all need one persistent process, which rules out serverless/
// edge deployment and is why there's a server.ts at all instead of plain `next start`.
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { initDb } from "./lib/db-init";
import { startScheduler } from "./lib/jobs/scheduler";
import { startWorker } from "./lib/jobs/queues";
import { icuSmokeTest } from "./lib/intl/jalali";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.HUB_PORT) || 4500;
const hostname = process.env.HUB_BIND || "127.0.0.1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  initDb();

  const icu = icuSmokeTest();
  if (!icu.ok) {
    console.warn(`[icu] Jalali calendar NOT available in this Node runtime (got calendar="${icu.calendar}", sample="${icu.sample}"). ` +
      "Dates will silently render as Gregorian. Use a full-ICU Node build (node:20, not node:20-slim/alpine) or set NODE_ICU_DATA.");
  } else {
    console.log(`[icu] Jalali calendar OK (sample: ${icu.sample})`);
  }

  await app.prepare();

  if (process.env.HUB_NO_JOBS !== "1") {
    startWorker("jobs", "current");
    startWorker("writeJobs", "writing");
    startWorker("readJobs", "reading");
    if (process.env.HUB_NO_SCHEDULE !== "1") startScheduler();
  }

  createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`> growth-hub-next on http://${hostname}:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
