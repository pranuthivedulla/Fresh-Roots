/**
 * Spike 3: the database. Writes and reads a load, a recommendation and a
 * decision on the hosted Postgres.
 *
 *   node --env-file=.env --experimental-strip-types scripts/spike3.ts
 *
 * Everything it writes is prefixed SPIKE3 and deleted at the end, so it never
 * touches real data. It also checks the constraints that encode the rules the
 * app must not be able to break: an exception cannot carry a verdict, a change
 * or a reject cannot be saved without a reason, a pause verdict cannot be
 * recorded without a note, and on-order cannot be null.
 *
 * What this does NOT prove: that it works from a deployed function. That half
 * of spike 3 needs the Vercel deploy and is reported separately.
 */

import { migrate } from "./migrate.ts";
import { checkUrlShapes, closePools, hostOf, MissingEnv, query, transaction } from "../lib/db.ts";
import { runRules } from "../lib/rules.ts";
import { demoRunDate, loadSampleDataset, sampleOnOrder } from "../lib/sample.ts";
import { formatCalendarDate } from "../lib/time.ts";

const LOAD_ID = "SPIKE3-load";
const RUN_ID = "SPIKE3-run";
const SKU_ID = "SPIKE3-SKU";
const DIST_ID = "SPIKE3-DIST";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function expectRejected(name: string, sql: string, values: unknown[], expectIn: string): Promise<void> {
  try {
    await query(sql, values);
    check(name, false, "the database accepted it; the constraint is not doing its job");
    await query("DELETE FROM recommendations WHERE run_id = $1 AND sku_id = $2", [RUN_ID, SKU_ID]).catch(() => {});
  } catch (err) {
    const message = (err as Error).message;
    check(name, message.includes(expectIn), message.includes(expectIn) ? "" : `rejected, but by "${message.split("\n")[0]}"`);
  }
}

console.log("Spike 3: the database");
console.log("=".repeat(80));

try {
  for (const note of checkUrlShapes()) console.log(`note: ${note}`);
  console.log(`Pooled host  ${hostOf("pooled") ?? "(unparseable)"}`);
  console.log(`Direct host  ${hostOf("direct") ?? "(unparseable)"}`);

  console.log("\n1. Migrations");
  const applied = await migrate((line) => console.log(line));
  console.log(`   ${applied} applied this run`);

  console.log("\n2. Schema is there");
  const expected = [
    "calendar", "decisions", "exports", "harm_events", "loads", "migrations",
    "on_order", "outcomes", "pauses", "recommendations", "runs", "settings",
    "settings_history", "sku_master", "stock_snapshots", "suppliers", "weekly_sales",
  ];
  const tables = (
    await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
  ).map((r) => r.table_name);
  const missing = expected.filter((t) => !tables.includes(t));
  check(`all ${expected.length} tables exist`, missing.length === 0, missing.join(", "));

  const backup = await query<{ value: string }>("SELECT value FROM settings WHERE key = 'backup_checker'");
  check("backup_checker seeded empty, never defaulted to Raghav", backup[0]?.value === "");

  console.log("\n3. Write a load, a run, a recommendation and a decision");

  // Real numbers from the rules, so the round trip carries what the app stores.
  const read = loadSampleDataset();
  if (!read.ok) throw new Error("the sample files must load");
  const result = runRules({
    dataset: read.dataset,
    onOrder: sampleOnOrder(read.dataset),
    runDate: demoRunDate(read.dataset),
  });
  const source = result.evaluations.find((e) => e.skuId === "SKU001")!;
  if (source.isException) throw new Error("SKU001 should not be an exception");

  const recommendationId = await transaction(async (c) => {
    await c.query(
      "INSERT INTO suppliers (distributor_id, name, region, status) VALUES ($1, 'Spike 3 test distributor', 'n/a', 'test') ON CONFLICT (distributor_id) DO NOTHING",
      [DIST_ID],
    );
    await c.query(
      `INSERT INTO sku_master (sku_id, sku_name, category, perishability, standard_reorder_qty, unit_of_measure, distributor_id)
       VALUES ($1, 'Spike 3 test SKU', 'test', 'Low', 500, 'Units', $2) ON CONFLICT (sku_id) DO NOTHING`,
      [SKU_ID, DIST_ID],
    );
    await c.query(
      `INSERT INTO loads (id, as_of_date, type, file_names, status)
       VALUES ($1, $2, 'full', $3, 'accepted')`,
      [LOAD_ID, formatCalendarDate(read.dataset.asOfDate), ["sku_master.csv", "current_inventory.csv"]],
    );
    await c.query("INSERT INTO runs (id, load_id, phase) VALUES ($1, $2, 'shadow')", [RUN_ID, LOAD_ID]);
    await c.query(
      "INSERT INTO on_order (run_id, sku_id, qty, prefilled, confirmed_by) VALUES ($1, $2, 0, false, 'spike3')",
      [RUN_ID, SKU_ID],
    );
    const rec = await c.query<{ id: string }>(
      `INSERT INTO recommendations (run_id, sku_id, avg12, avg4, uplift_applied, cover, flag, qty, rules_fired, is_exception)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, false) RETURNING id`,
      [
        RUN_ID, SKU_ID,
        source.numbers.avg12, source.numbers.avg4, source.numbers.upliftApplied,
        source.numbers.cover, source.flag, source.recommendedQty,
        JSON.stringify(source.rulesFired),
      ],
    );
    const id = Number(rec.rows[0]!.id);
    await c.query(
      `INSERT INTO decisions (recommendation_id, action, final_qty, reason_code, reason_text)
       VALUES ($1, 'change', 600, 'supplier-moq', 'Distributor ships in cases of 100')`,
      [id],
    );
    return id;
  });
  check("the whole write committed in one transaction", Number.isFinite(recommendationId));

  console.log("\n4. Read it back on a new connection");
  const rows = await query<{
    load_as_of: Date; load_type: string; file_names: string[];
    phase: string; on_order_qty: number;
    avg12: string; avg4: string; uplift_applied: string; cover: string;
    flag: string; qty: number; rules_fired: unknown; is_exception: boolean;
    action: string; final_qty: number; reason_code: string;
  }>(
    `SELECT l.as_of_date AS load_as_of, l.type AS load_type, l.file_names,
            r.phase, o.qty AS on_order_qty,
            rec.avg12, rec.avg4, rec.uplift_applied, rec.cover, rec.flag, rec.qty,
            rec.rules_fired, rec.is_exception,
            d.action, d.final_qty, d.reason_code
       FROM recommendations rec
       JOIN runs r    ON r.id = rec.run_id
       JOIN loads l   ON l.id = r.load_id
       JOIN on_order o ON o.run_id = r.id AND o.sku_id = rec.sku_id
       JOIN decisions d ON d.recommendation_id = rec.id
      WHERE rec.id = $1`,
    [recommendationId],
  );
  check("one joined row came back", rows.length === 1);
  const got = rows[0]!;
  if (got) {
    check("as-of date survived", formatCalendarDate({
      year: got.load_as_of.getFullYear(), month: got.load_as_of.getMonth() + 1, day: got.load_as_of.getDate(),
    }) === formatCalendarDate(read.dataset.asOfDate));
    check("file_names survived as an array", Array.isArray(got.file_names) && got.file_names.length === 2);
    check("on-order stored as an explicit 0", got.on_order_qty === 0);
    check("flag survived", got.flag === source.flag, `${got.flag} vs ${source.flag}`);
    check("quantity survived", got.qty === source.recommendedQty, `${got.qty} vs ${source.recommendedQty}`);
    check(
      "avg12 survived to 4 decimal places",
      Math.abs(Number(got.avg12) - source.numbers.avg12!) < 1e-4,
      `${got.avg12} vs ${source.numbers.avg12}`,
    );
    check(
      "cover survived to 4 decimal places",
      Math.abs(Number(got.cover) - source.numbers.cover!) < 1e-4,
      `${got.cover} vs ${source.numbers.cover}`,
    );
    check(
      "rules_fired survived as structured json",
      Array.isArray(got.rules_fired) && (got.rules_fired as unknown[]).length === source.rulesFired.length,
    );
    check("the decision survived with its reason", got.action === "change" && got.final_qty === 600 && got.reason_code === "supplier-moq");
    // Worth knowing before the app layer is written.
    console.log(`        note: numeric columns come back as ${typeof got.avg12}, not number. The app layer must parse them.`);
  }

  console.log("\n5. The constraints the app must not be able to break");
  await expectRejected(
    "an exception cannot carry a flag or a quantity",
    `INSERT INTO recommendations (run_id, sku_id, is_exception, exception_reason, flag, qty)
     VALUES ($1, $2, true, '[{"kind":"short-history"}]'::jsonb, 'stockout', 500)`,
    [RUN_ID, SKU_ID],
    "exception_has_no_verdict",
  );
  await expectRejected(
    "a change cannot be saved without a reason",
    "INSERT INTO decisions (recommendation_id, action, final_qty) VALUES ($1, 'change', 400)",
    [recommendationId],
    "reason_required",
  );
  await expectRejected(
    "a pause verdict cannot be recorded without a note",
    "INSERT INTO pauses (trigger, rca_due_at, verdict, decided_at) VALUES ('test', now(), 'fix-and-restart', now())",
    [],
    "verdict_needs_a_note",
  );
  await expectRejected(
    "on-order cannot be null",
    "INSERT INTO on_order (run_id, sku_id, qty, confirmed_by) VALUES ($1, $2, NULL, 'spike3')",
    [RUN_ID, SKU_ID],
    "null value in column",
  );
  await expectRejected(
    "perishability cannot be anything but Low or High",
    `INSERT INTO sku_master (sku_id, sku_name, perishability, standard_reorder_qty) VALUES ('SPIKE3-BAD', 'x', 'Medium', 1)`,
    [],
    "sku_master_perishability_check",
  );

  console.log("\n6. Clean up");
  await query("DELETE FROM runs WHERE id = $1", [RUN_ID]);
  await query("DELETE FROM loads WHERE id = $1", [LOAD_ID]);
  await query("DELETE FROM sku_master WHERE sku_id LIKE 'SPIKE3%'");
  await query("DELETE FROM suppliers WHERE distributor_id = $1", [DIST_ID]);
  const left = await query<{ n: string }>(
    "SELECT (SELECT count(*) FROM loads WHERE id LIKE 'SPIKE3%') + (SELECT count(*) FROM sku_master WHERE sku_id LIKE 'SPIKE3%') AS n",
  );
  check("nothing of this spike is left behind", left[0]!.n === "0", `${left[0]!.n} rows remain`);

  console.log("\n" + "=".repeat(80));
  console.log(failures === 0 ? "Spike 3 passed against the hosted Postgres." : `${failures} check(s) failed.`);
  console.log("Not covered here: the same round trip from a DEPLOYED function. That needs the Vercel deploy.");
} catch (err) {
  failures++;
  if (err instanceof MissingEnv) {
    console.error(`\nCannot run: ${err.message}`);
  } else {
    const m = (err as Error).message;
    console.error(`\nFailed: ${m}`);
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(m)) {
      console.error("That is a network or host problem, not a schema one. Check the host in .env and that the Neon project is not suspended.");
    }
    if (/password authentication failed/i.test(m)) {
      console.error("The credentials in the connection string were rejected. Copy the string again from the Neon dashboard.");
    }
  }
}

await closePools();
process.exit(failures === 0 ? 0 : 1);
