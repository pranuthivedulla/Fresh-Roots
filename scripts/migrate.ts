/**
 * Applies every .sql file in db/ once, in filename order, on the DIRECT
 * connection. A pooled connection cannot run schema changes.
 *
 *   node --env-file=.env --experimental-strip-types scripts/migrate.ts
 *
 * Each file runs inside one transaction and is recorded in `migrations`, so a
 * second run is a no-op and a half-applied file cannot be left behind.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkUrlShapes, closePools, hostOf, MissingEnv, pool } from "../lib/db.ts";

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

export async function migrate(log: (line: string) => void = console.log): Promise<number> {
  for (const note of checkUrlShapes()) log(`  note: ${note}`);
  log(`  connecting to ${hostOf("direct") ?? "(unparseable host)"}`);

  const client = await pool("direct").connect();
  let applied = 0;
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query<{ filename: string }>("SELECT filename FROM migrations")).rows.map((r) => r.filename),
    );
    const files = readdirSync(DB_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) {
        log(`  skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(DB_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied++;
        log(`  apply ${file}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`${file} failed and was rolled back: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return applied;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain) {
  console.log("Migrations");
  try {
    const n = await migrate();
    console.log(`\n${n === 0 ? "Nothing to apply; the schema is current." : `${n} migration(s) applied.`}`);
  } catch (err) {
    if (err instanceof MissingEnv) console.error(`\n${err.message}`);
    else console.error(`\n${(err as Error).message}`);
    await closePools();
    process.exit(1);
  }
  await closePools();
}
