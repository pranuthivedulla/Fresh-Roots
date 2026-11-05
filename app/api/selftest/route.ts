import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query, transaction } from "../../../lib/db.ts";
import { shortError } from "../../../lib/status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The second half of spike 3: the same write-and-read round trip, but run
 * from a deployed function rather than from a laptop.
 *
 * Not public. It needs `Authorization: Bearer $CRON_SECRET`, because it
 * writes, and because an unauthenticated endpoint that writes is an
 * unauthenticated endpoint that writes. Everything it writes is prefixed
 * SELFTEST and deleted before it returns, inside one transaction that is
 * rolled back, so a failure halfway cannot leave rows behind.
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  const note = (step: string, ok: boolean, detail?: string) => steps.push({ step, ok, detail });

  try {
    // One transaction, rolled back at the end: the round trip is proven and
    // the database is left exactly as it was found.
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO suppliers (distributor_id, name, region, status) VALUES ('SELFTEST-DIST', 'self test', 'n/a', 'test')",
      );
      await c.query(
        `INSERT INTO sku_master (sku_id, sku_name, category, perishability, standard_reorder_qty, unit_of_measure, distributor_id)
         VALUES ('SELFTEST-SKU', 'self test', 'test', 'Low', 500, 'Units', 'SELFTEST-DIST')`,
      );
      await c.query(
        `INSERT INTO loads (id, as_of_date, type, file_names, status)
         VALUES ('SELFTEST-load', CURRENT_DATE, 'full', ARRAY['selftest.csv'], 'accepted')`,
      );
      await c.query("INSERT INTO runs (id, load_id, phase) VALUES ('SELFTEST-run', 'SELFTEST-load', 'shadow')");
      note("write a load and a run", true);

      await c.query(
        "INSERT INTO on_order (run_id, sku_id, qty, prefilled, confirmed_by) VALUES ('SELFTEST-run', 'SELFTEST-SKU', 0, false, 'selftest')",
      );
      const rec = await c.query<{ id: string }>(
        `INSERT INTO recommendations (run_id, sku_id, avg12, avg4, uplift_applied, cover, flag, qty, rules_fired, is_exception)
         VALUES ('SELFTEST-run', 'SELFTEST-SKU', 214.9167, 261.0000, 1.00, 4.1876, 'stockout', 750,
                 '[{"rule":"rule-1-weeks-of-cover","detail":"selftest"}]'::jsonb, false)
         RETURNING id`,
      );
      const id = Number(rec.rows[0]!.id);
      note("write a recommendation", Number.isFinite(id));

      await c.query(
        `INSERT INTO decisions (recommendation_id, action, final_qty, reason_code, reason_text)
         VALUES ($1, 'change', 600, 'supplier-moq', 'self test')`,
        [id],
      );
      note("write a decision", true);

      const back = await c.query<{ cover: string; flag: string; action: string; final_qty: number }>(
        `SELECT rec.cover, rec.flag, d.action, d.final_qty
           FROM recommendations rec JOIN decisions d ON d.recommendation_id = rec.id
          WHERE rec.id = $1`,
        [id],
      );
      const row = back.rows[0];
      note(
        "read all three back",
        row?.flag === "stockout" && row?.action === "change" && row?.final_qty === 600,
        row ? `cover came back as ${typeof row.cover}` : "no row",
      );

      // The constraint must hold inside a deployed function too, not only locally.
      let rejected = false;
      try {
        await c.query("SAVEPOINT probe");
        await c.query(
          "INSERT INTO decisions (recommendation_id, action, final_qty) VALUES ($1, 'reject', 0)",
          [id],
        );
        await c.query("RELEASE SAVEPOINT probe");
      } catch {
        rejected = true;
        await c.query("ROLLBACK TO SAVEPOINT probe");
      }
      note("a reject with no reason is refused by the database", rejected);

      throw new RollbackSignal();
    });
  } catch (err) {
    if (!(err instanceof RollbackSignal)) {
      note("round trip", false, shortError(err));
      return NextResponse.json(
        { ok: false, steps, ranOn: "deployed function" },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
  }

  // Prove the rollback really happened: nothing SELFTEST is left.
  let leftovers = -1;
  try {
    const [row] = await query<{ n: string }>(
      "SELECT (SELECT count(*) FROM loads WHERE id LIKE 'SELFTEST%') + (SELECT count(*) FROM sku_master WHERE sku_id LIKE 'SELFTEST%') AS n",
    );
    leftovers = Number(row!.n);
  } catch (err) {
    note("check for leftovers", false, shortError(err));
  }
  note("nothing was left behind", leftovers === 0, leftovers > 0 ? `${leftovers} rows remain` : undefined);

  const ok = steps.every((s) => s.ok);
  return NextResponse.json(
    { ok, steps, ranOn: "deployed function" },
    { status: ok ? 200 : 500, headers: { "cache-control": "no-store" } },
  );
}

class RollbackSignal extends Error {}

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret === "") return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
