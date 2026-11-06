/**
 * What Raghav did with each recommendation, and what actually left the app.
 *
 * Three actions: accept, change (reason required) and reject (reason
 * required). The reason is a code from a short list plus optional free text,
 * so the RCA can group rejections by reason without reading prose.
 *
 * Rejection rate is computed from what was exported, not from a self-report.
 * The decisions table records the action; the export records what actually
 * went to Zoho; `rejectionCounts` reads the decisions attached to the run that
 * produced the export, so a SKU that was quietly dropped still counts.
 */

import { query, transaction } from "./db.ts";

export {
  CHANGE_REASONS,
  REJECT_REASONS,
  reasonLabel,
  type Action,
  type SavedDecision,
} from "./decision-reasons.ts";
import type { Action, SavedDecision } from "./decision-reasons.ts";

export async function decisionsFor(runId: string): Promise<Map<number, SavedDecision>> {
  const rows = await query<{
    recommendation_id: string; action: Action; final_qty: number | null;
    reason_code: string | null; reason_text: string | null; decided_at: Date;
  }>(
    `SELECT d.recommendation_id, d.action, d.final_qty, d.reason_code, d.reason_text, d.decided_at
       FROM decisions d JOIN recommendations r ON r.id = d.recommendation_id
      WHERE r.run_id = $1`,
    [runId],
  );
  return new Map(
    rows.map((r) => [
      Number(r.recommendation_id),
      {
        recommendationId: Number(r.recommendation_id),
        action: r.action,
        finalQty: r.final_qty === null ? null : Number(r.final_qty),
        reasonCode: r.reason_code,
        reasonText: r.reason_text,
        decidedAt: r.decided_at,
      },
    ]),
  );
}

/** One decision per recommendation. Deciding again replaces the earlier one. */
export async function recordDecision(args: {
  recommendationId: number;
  action: Action;
  finalQty: number | null;
  reasonCode: string | null;
  reasonText: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO decisions (recommendation_id, action, final_qty, reason_code, reason_text, decided_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (recommendation_id) DO UPDATE SET
       action = EXCLUDED.action, final_qty = EXCLUDED.final_qty,
       reason_code = EXCLUDED.reason_code, reason_text = EXCLUDED.reason_text,
       decided_at = now()`,
    [args.recommendationId, args.action, args.finalQty, args.reasonCode, args.reasonText],
  );
}

/** Accepts every flagged recommendation that has no decision yet. */
export async function acceptAllUndecided(runId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `INSERT INTO decisions (recommendation_id, action, final_qty, decided_at)
     SELECT r.id, 'accept', r.qty, now()
       FROM recommendations r
      WHERE r.run_id = $1 AND r.is_exception = false AND r.flag <> 'in-range'
        AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.recommendation_id = r.id)
     RETURNING recommendation_id AS id`,
    [runId],
  );
  return rows.length;
}

// --------------------------------------------------------- review timing

/** Set once, when the review screen is first shown for a run. */
export async function markReviewStarted(runId: string): Promise<void> {
  await query("UPDATE runs SET review_started_at = now() WHERE id = $1 AND review_started_at IS NULL", [runId]);
}

export async function markReviewEnded(runId: string): Promise<void> {
  await query("UPDATE runs SET review_ended_at = now() WHERE id = $1", [runId]);
}

// ---------------------------------------------------------------- export

export type ExportRecord = {
  id: number;
  runId: string;
  exportedAt: Date;
  sentConfirmedAt: Date | null;
  rowCount: number;
};

export async function latestExport(runId: string): Promise<ExportRecord | null> {
  const [r] = await query<{
    id: string; run_id: string; exported_at: Date; sent_confirmed_at: Date | null; row_count: number;
  }>("SELECT * FROM exports WHERE run_id = $1 ORDER BY exported_at DESC LIMIT 1", [runId]);
  return r
    ? {
        id: Number(r.id),
        runId: r.run_id,
        exportedAt: r.exported_at,
        sentConfirmedAt: r.sent_confirmed_at,
        rowCount: Number(r.row_count),
      }
    : null;
}

/**
 * The rows that go to Zoho: accepted and changed recommendations to order,
 * with the quantity Raghav settled on. Rejected ones and holds are not here.
 */
export type ExportRow = {
  skuId: string;
  skuName: string;
  distributorId: string;
  qty: number;
  unitOfMeasure: string;
};

export async function exportRows(runId: string): Promise<ExportRow[]> {
  return (
    await query<{
      sku_id: string; sku_name: string; distributor_id: string | null;
      qty: number; unit_of_measure: string;
    }>(
      `SELECT r.sku_id, m.sku_name, m.distributor_id, m.unit_of_measure,
              COALESCE(d.final_qty, r.qty) AS qty
         FROM recommendations r
         JOIN sku_master m ON m.sku_id = r.sku_id
         JOIN decisions d  ON d.recommendation_id = r.id
        WHERE r.run_id = $1
          AND r.is_exception = false
          AND d.action <> 'reject'
          AND COALESCE(d.final_qty, r.qty) > 0
        ORDER BY m.distributor_id, r.sku_id`,
      [runId],
    )
  ).map((r) => ({
    skuId: r.sku_id,
    skuName: r.sku_name,
    distributorId: r.distributor_id ?? "",
    qty: Number(r.qty),
    unitOfMeasure: r.unit_of_measure,
  }));
}

export function toCsv(rows: ExportRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    "SKU_ID,SKU_Name,Distributor_ID,Quantity,Unit_of_Measure",
    ...rows.map((r) => [esc(r.skuId), esc(r.skuName), esc(r.distributorId), r.qty, esc(r.unitOfMeasure)].join(",")),
  ].join("\n");
}

export async function recordExport(runId: string, rowCount: number): Promise<number> {
  return await transaction(async (c) => {
    await c.query("UPDATE runs SET review_ended_at = now() WHERE id = $1", [runId]);
    const r = await c.query<{ id: string }>(
      "INSERT INTO exports (run_id, exported_at, row_count) VALUES ($1, now(), $2) RETURNING id",
      [runId, rowCount],
    );
    return Number(r.rows[0]!.id);
  });
}

/**
 * Raghav confirming he sent the file. Until this, the status word is
 * "exported". After it, "sent to Zoho (confirmed by Raghav)". Never "ordered":
 * the app has not ordered anything and cannot know that Zoho did.
 */
export async function confirmSentToZoho(exportId: number): Promise<void> {
  await query(
    "UPDATE exports SET sent_confirmed_at = now() WHERE id = $1 AND sent_confirmed_at IS NULL",
    [exportId],
  );
}

// ------------------------------------------------------- rejection rate

export type RejectionCounts = { accepted: number; changed: number; rejected: number; undecided: number };

/**
 * Counted over rule-covered recommendations only. Exceptions carry no
 * recommendation, so there is nothing to accept or reject and they are
 * excluded, as the specification requires.
 */
export async function rejectionCounts(runId: string): Promise<RejectionCounts> {
  const [row] = await query<{ accepted: string; changed: string; rejected: string; undecided: string }>(
    `SELECT
       count(*) FILTER (WHERE d.action = 'accept')                AS accepted,
       count(*) FILTER (WHERE d.action = 'change')                AS changed,
       count(*) FILTER (WHERE d.action = 'reject')                AS rejected,
       count(*) FILTER (WHERE d.recommendation_id IS NULL)        AS undecided
     FROM recommendations r
     LEFT JOIN decisions d ON d.recommendation_id = r.id
     WHERE r.run_id = $1 AND r.is_exception = false AND r.flag <> 'in-range'`,
    [runId],
  );
  return {
    accepted: Number(row?.accepted ?? 0),
    changed: Number(row?.changed ?? 0),
    rejected: Number(row?.rejected ?? 0),
    undecided: Number(row?.undecided ?? 0),
  };
}
