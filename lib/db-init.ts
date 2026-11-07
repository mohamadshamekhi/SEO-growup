// Runs the schema once at boot, same idempotent approach as hub/db.py's init(): a single
// executescript() of CREATE-TABLE-IF-NOT-EXISTS statements, no migration-history table.
// Call this once from server.ts before anything else touches the DB.
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

export function initDb() {
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  db.exec(schema);
}
