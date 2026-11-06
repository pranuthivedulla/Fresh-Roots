/**
 * Runs: the on-order Raghav confirmed, the recommendations the rules produced,
 * and the numbers behind each one.
 *
 * A recommendation row always carries the arithmetic that produced it — avg12,
 * avg4, the uplift, the cover, and which rules fired. That is what the why
 * drawer shows and what lets Deepa test the rules rather than trust them.
 */

import { query, transaction } from "./db.ts";
import type { Phase } from "./phase.ts";
import type { Evaluation, ExceptionReason, Flag, RuleFired } from "./rules.ts";

export type SavedRun = {
  id: string;
  loadId: string;
  runAt: Date;
  phase: Phase;
  reviewStartedAt: Date | null;
  reviewEndedAt: Date | null;
};

export type SavedRecommendation = {
  id: number;
  skuId: string;
  skuName: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  distributorId: string;
  unitOfMeasure: string;
  avg12: number | null;
  avg4: number | null;
  upliftApplied: number;
  cover: number | null;
  flag: Flag | null;
  qty: number | null;
  rulesFired: RuleFired[];
  isException: boolean;
  exceptionReasons: ExceptionReason[];
  onOrder: number;
  unitsOnHand: number | null;
};

/** Writes the run, the confirmed on-order and every recommendation, atomically. */
export async function saveRun(args: {
  runId: string;
  loadId: string;
  phase: Phase;
  onOrder: Map<string, number>;
  prefilled: Set<string>;
  confirmedBy: string;
  evaluations: Evaluation[];
}): Promise<void> {
  await transaction(async (c) => {
    await c.query("INSERT INTO runs (id, load_id, phase) VALUES ($1, $2, $3)", [
      args.runId,
      args.loadId,
      args.phase,
    ]);

    const skuIds = [...args.onOrder.keys()];
    await c.query(
      `INSERT INTO on_order (run_id, sku_id, qty, prefilled, confirmed_by)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::boolean[], $5::text[])`,
      [
        skuIds.map(() => args.runId),
        skuIds,
        skuIds.map((id) => args.onOrder.get(id)!),
        skuIds.map((id) => args.prefilled.has(id)),
        skuIds.map(() => args.confirmedBy),
      ],
    );

    const e = args.evaluations;
    await c.query(
      `INSERT INTO recommendations
         (run_id, sku_id, avg12, avg4, uplift_applied, cover, flag, qty, rules_fired, is_exception, exception_reason)
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[],
         $7::text[], $8::int[], $9::jsonb[], $10::boolean[], $11::jsonb[])`,
      [
        e.map(() => args.runId),
        e.map((x) => x.skuId),
        e.map((x) => x.numbers.avg12),
        e.map((x) => x.numbers.avg4),
        e.map((x) => x.numbers.upliftApplied),
        e.map((x) => x.numbers.cover),
        e.map((x) => (x.isException ? null : x.flag)),
        e.map((x) => (x.isException ? null : x.recommendedQty)),
        e.map((x) => JSON.stringify(x.rulesFired)),
        e.map((x) => x.isException),
        e.map((x) => (x.isException ? JSON.stringify(x.exceptionReasons) : null)),
      ],
    );
  });
}

export async function latestRunForLoad(loadId: string): Promise<SavedRun | null> {
  const [r] = await query<{
    id: string; load_id: string; run_at: Date; phase: Phase;
    review_started_at: Date | null; review_ended_at: Date | null;
  }>("SELECT * FROM runs WHERE load_id = $1 ORDER BY run_at DESC LIMIT 1", [loadId]);
  return r
    ? {
        id: r.id,
        loadId: r.load_id,
        runAt: r.run_at,
        phase: r.phase,
        reviewStartedAt: r.review_started_at,
        reviewEndedAt: r.review_ended_at,
      }
    : null;
}

export async function recommendationsFor(runId: string): Promise<SavedRecommendation[]> {
  const rows = await query<{
    id: string; sku_id: string; sku_name: string; perishability: "Low" | "High";
    standard_reorder_qty: number; distributor_id: string | null; unit_of_measure: string;
    avg12: string | null; avg4: string | null; uplift_applied: string; cover: string | null;
    flag: Flag | null; qty: number | null; rules_fired: RuleFired[];
    is_exception: boolean; exception_reason: ExceptionReason[] | null;
    on_order: number; units_on_hand: number | null;
  }>(
    `SELECT r.id, r.sku_id, m.sku_name, m.perishability, m.standard_reorder_qty,
            m.distributor_id, m.unit_of_measure,
            r.avg12, r.avg4, r.uplift_applied, r.cover, r.flag, r.qty,
            r.rules_fired, r.is_exception, r.exception_reason,
            o.qty AS on_order,
            (SELECT s.units_on_hand FROM stock_snapshots s
              WHERE s.sku_id = r.sku_id ORDER BY s.as_of_date DESC LIMIT 1) AS units_on_hand
       FROM recommendations r
       JOIN sku_master m ON m.sku_id = r.sku_id
       JOIN on_order o   ON o.run_id = r.run_id AND o.sku_id = r.sku_id
      WHERE r.run_id = $1
      ORDER BY r.sku_id`,
    [runId],
  );

  // pg returns numeric as string. Parsing here, once, keeps it out of the UI.
  const num = (v: string | null) => (v === null ? null : Number(v));

  return rows.map((r) => ({
    id: Number(r.id),
    skuId: r.sku_id,
    skuName: r.sku_name,
    perishability: r.perishability,
    standardReorderQty: Number(r.standard_reorder_qty),
    distributorId: r.distributor_id ?? "",
    unitOfMeasure: r.unit_of_measure,
    avg12: num(r.avg12),
    avg4: num(r.avg4),
    upliftApplied: Number(r.uplift_applied),
    cover: num(r.cover),
    flag: r.flag,
    qty: r.qty === null ? null : Number(r.qty),
    rulesFired: r.rules_fired ?? [],
    isException: r.is_exception,
    exceptionReasons: r.exception_reason ?? [],
    onOrder: Number(r.on_order),
    unitsOnHand: r.units_on_hand === null ? null : Number(r.units_on_hand),
  }));
}

/**
 * What to pre-fill each SKU's on-order with: the quantity in the last list the
 * app exported for that SKU. The app knows what was sent, so Raghav confirms
 * or edits rather than retyping. A SKU never exported gets nothing, and a
 * blank still blocks the run.
 */
export async function prefillOnOrder(): Promise<Map<string, number>> {
  const rows = await query<{ sku_id: string; qty: number }>(
    `SELECT DISTINCT ON (rec.sku_id) rec.sku_id,
            COALESCE(d.final_qty, rec.qty) AS qty
       FROM exports e
       JOIN recommendations rec ON rec.run_id = e.run_id
       LEFT JOIN decisions d ON d.recommendation_id = rec.id
      WHERE e.sent_confirmed_at IS NOT NULL
        AND COALESCE(d.action, 'accept') <> 'reject'
        AND COALESCE(d.final_qty, rec.qty) > 0
      ORDER BY rec.sku_id, e.sent_confirmed_at DESC`,
  );
  return new Map(rows.map((r) => [r.sku_id, Number(r.qty)]));
}
