/**
 * The synthetic pause test from section 12 and the definition of done.
 *
 *   node --env-file=.env --experimental-strip-types scripts/pause-test.ts
 *
 * Builds reviews with controlled rejection rates and checks that the app
 * pauses exactly when it should and not otherwise:
 *
 *   shadow,  two reviews at 100%   -> does NOT pause
 *   tuning,  one review above 75%  -> does NOT pause (needs two consecutive)
 *   tuning,  two reviews above 75% -> pauses
 *   steady,  two reviews at 40%    -> pauses (the limit is 25%)
 *   steady,  two reviews at 20%    -> does NOT pause
 *   any,     harm event of Rs 1L   -> does NOT pause
 *   any,     harm event of Rs 2.5L -> pauses immediately
 *
 * Everything it writes is prefixed PAUSETEST and removed at the end, so it
 * can be run against the real database without leaving anything behind.
 */

import { closePools, query, transaction } from "../lib/db.ts";
import { checkRejectionPause } from "../lib/pause.ts";
import { recordHarmEvent } from "../lib/pause.ts";
import type { Phase } from "../lib/phase.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function wipe(): Promise<void> {
  await query("DELETE FROM decisions WHERE recommendation_id IN (SELECT id FROM recommendations WHERE run_id LIKE 'PAUSETEST%')");
  await query("DELETE FROM recommendations WHERE run_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM on_order WHERE run_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM exports WHERE run_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM runs WHERE id LIKE 'PAUSETEST%'");
  await query("DELETE FROM stock_snapshots WHERE load_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM weekly_sales WHERE load_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM loads WHERE id LIKE 'PAUSETEST%'");
  await query("DELETE FROM sku_master WHERE sku_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM suppliers WHERE distributor_id LIKE 'PAUSETEST%'");
  await query("DELETE FROM harm_events WHERE recorded_by = 'PAUSETEST'");
  await query("DELETE FROM pauses WHERE trigger LIKE '%PAUSETEST%' OR trigger LIKE 'Rejections above%' OR trigger LIKE 'Harm event%'");
}

/** One completed review: `total` recommendations, `rejected` of them refused. */
async function makeReview(label: string, total: number, rejected: number, order: number): Promise<void> {
  const loadId = `PAUSETEST-load-${label}`;
  const runId = `PAUSETEST-run-${label}`;
  await transaction(async (c) => {
    await c.query(
      `INSERT INTO loads (id, as_of_date, type, file_names, status) VALUES ($1, CURRENT_DATE, 'full', ARRAY['synthetic'], 'accepted')`,
      [loadId],
    );
    // review_ended_at ordering decides which two reviews are "the last two".
    await c.query(
      `INSERT INTO runs (id, load_id, run_at, phase, review_started_at, review_ended_at)
       VALUES ($1, $2, now() - ($3 || ' hours')::interval, 'tuning',
               now() - ($3 || ' hours')::interval, now() - ($3 || ' hours')::interval + interval '10 minutes')`,
      [runId, loadId, String(order)],
    );
    for (let i = 0; i < total; i++) {
      const skuId = `PAUSETEST-SKU${i}`;
      await c.query(
        `INSERT INTO suppliers (distributor_id, name) VALUES ('PAUSETEST-DIST', 'synthetic') ON CONFLICT DO NOTHING`,
      );
      await c.query(
        `INSERT INTO sku_master (sku_id, sku_name, perishability, standard_reorder_qty, distributor_id)
         VALUES ($1, 'synthetic', 'Low', 100, 'PAUSETEST-DIST') ON CONFLICT DO NOTHING`,
        [skuId],
      );
      await c.query(
        `INSERT INTO on_order (run_id, sku_id, qty, confirmed_by) VALUES ($1, $2, 0, 'PAUSETEST')`,
        [runId, skuId],
      );
      const rec = await c.query<{ id: string }>(
        `INSERT INTO recommendations (run_id, sku_id, cover, flag, qty, is_exception)
         VALUES ($1, $2, 2.0, 'stockout', 100, false) RETURNING id`,
        [runId, skuId],
      );
      const id = Number(rec.rows[0]!.id);
      const isRejected = i < rejected;
      await c.query(
        `INSERT INTO decisions (recommendation_id, action, final_qty, reason_code)
         VALUES ($1, $2, $3, $4)`,
        isRejected ? [id, "reject", null, "disagree-with-rule"] : [id, "accept", 100, null],
      );
    }
  });
}

async function openPause(): Promise<string | null> {
  const [row] = await query<{ trigger: string }>(
    "SELECT trigger FROM pauses WHERE verdict IS NULL ORDER BY started_at DESC LIMIT 1",
  );
  return row?.trigger ?? null;
}

async function clearPauses(): Promise<void> {
  await query("DELETE FROM pauses");
}

async function scenario(
  name: string,
  phase: Phase,
  pauseAbove: number | null,
  alertAbove: number | null,
  reviews: { total: number; rejected: number }[],
  expectPaused: boolean,
): Promise<void> {
  await wipe();
  await clearPauses();
  // Oldest first, so the newest review ends up newest by review_ended_at.
  for (const [i, r] of reviews.entries()) {
    await makeReview(`${name.replace(/\W+/g, "")}-${i}`, r.total, r.rejected, reviews.length - i);
  }
  const result = await checkRejectionPause(phase, pauseAbove, alertAbove);
  const paused = (await openPause()) !== null;
  check(
    name,
    paused === expectPaused,
    `${[...result.rates].reverse().map((r) => `${((r.rate ?? 0) * 100).toFixed(0)}%`).join(" then ") || "no reviews"} — ${result.reason}`,
  );
}

console.log("Synthetic pause test");
console.log("=".repeat(96));

try {
  console.log("\nRejection-rate pauses");
  await scenario("shadow never pauses, even at 100% twice", "shadow", null, null,
    [{ total: 10, rejected: 10 }, { total: 10, rejected: 10 }], false);

  await scenario("tuning does not pause on ONE review above 75%", "tuning", 0.75, 0.5,
    [{ total: 10, rejected: 9 }], false);

  await scenario("tuning does not pause when only the newest is above 75%", "tuning", 0.75, 0.5,
    [{ total: 10, rejected: 9 }, { total: 10, rejected: 3 }], false);

  await scenario("tuning PAUSES on two consecutive reviews above 75%", "tuning", 0.75, 0.5,
    [{ total: 10, rejected: 9 }, { total: 10, rejected: 8 }], true);

  await scenario("tuning does not pause at exactly 75% (the rule says above)", "tuning", 0.75, 0.5,
    [{ total: 4, rejected: 3 }, { total: 4, rejected: 3 }], false);

  await scenario("steady PAUSES on two consecutive reviews above 25%", "steady", 0.25, null,
    [{ total: 10, rejected: 4 }, { total: 10, rejected: 4 }], true);

  await scenario("steady does not pause at 20%", "steady", 0.25, null,
    [{ total: 10, rejected: 2 }, { total: 10, rejected: 2 }], false);

  console.log("\nAlerting without pausing");
  await wipe();
  await clearPauses();
  await makeReview("alert-0", 10, 6, 1);
  const alertCheck = await checkRejectionPause("tuning", 0.75, 0.5);
  check(
    "tuning alerts Deepa above 50% without pausing",
    alertCheck.alert && !alertCheck.paused && (await openPause()) === null,
    alertCheck.reason,
  );

  console.log("\nHarm events");
  await wipe();
  await clearPauses();
  const small = await recordHarmEvent({ skuId: null, valueInr: 100_000, recordedBy: "PAUSETEST", note: "synthetic" });
  check("a Rs 1,00,000 harm event does not pause", !small.paused && (await openPause()) === null);

  await clearPauses();
  const big = await recordHarmEvent({ skuId: null, valueInr: 250_000, recordedBy: "PAUSETEST", note: "synthetic" });
  const trigger = await openPause();
  check("a Rs 2,50,000 harm event pauses immediately", big.paused && trigger !== null, trigger ?? "");

  console.log("\nAnd it stays paused without a decision");
  const stillPaused = await openPause();
  check("no timer resumes it", stillPaused !== null, "a verdict with a written note is the only way back");
} catch (err) {
  failures++;
  console.error(`\nFailed: ${(err as Error).message}`);
} finally {
  await wipe();
  await clearPauses();
  console.log("\ncleaned up");
}

console.log("=".repeat(96));
console.log(failures === 0 ? "All pause scenarios behaved as specified." : `${failures} scenario(s) did not.`);
await closePools();
process.exit(failures === 0 ? 0 : 1);
