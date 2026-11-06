/**
 * Pausing, and the root cause analysis that follows it.
 *
 * Three ways the app pauses, and no fourth:
 *   - tuning phase, rejections above 75% in two consecutive reviews
 *   - steady phase, rejections above 25% in two consecutive reviews
 *   - any phase, a recorded harm event above Rs 2,00,000 on one SKU
 *
 * Shadow phase never pauses on rejections, by design: the whole point of
 * running beside the manual process is to find out how often the rules are
 * wrong without that stopping anything.
 *
 * No decision means it stays paused. There is no timer that resumes it, and
 * no way to resume it except Deepa recording a verdict with a written note.
 */

import { query, transaction } from "./db.ts";
import { HARM_EVENT_PAUSE_INR, rejectionRate, type Phase } from "./phase.ts";

export type Verdict = "fix-and-restart" | "redesign" | "permanent-kill";

export type Pause = {
  id: number;
  trigger: string;
  startedAt: Date;
  rcaDueAt: Date;
  verdict: Verdict | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  note: string | null;
};

/**
 * The app is paused while a pause has no verdict, and stays stopped after a
 * verdict of redesign or permanent kill. Only fix-and-restart resumes it.
 */
export async function currentPause(): Promise<Pause | null> {
  const [row] = await query<{
    id: string; trigger: string; started_at: Date; rca_due_at: Date;
    verdict: Verdict | null; decided_at: Date | null; decided_by: string | null; note: string | null;
  }>(
    `SELECT * FROM pauses
      WHERE verdict IS NULL OR verdict IN ('redesign', 'permanent-kill')
      ORDER BY started_at DESC LIMIT 1`,
  );
  return row
    ? {
        id: Number(row.id),
        trigger: row.trigger,
        startedAt: row.started_at,
        rcaDueAt: row.rca_due_at,
        verdict: row.verdict,
        decidedAt: row.decided_at,
        decidedBy: row.decided_by,
        note: row.note,
      }
    : null;
}

export async function allPauses(): Promise<Pause[]> {
  const rows = await query<{
    id: string; trigger: string; started_at: Date; rca_due_at: Date;
    verdict: Verdict | null; decided_at: Date | null; decided_by: string | null; note: string | null;
  }>("SELECT * FROM pauses ORDER BY started_at DESC LIMIT 25");
  return rows.map((r) => ({
    id: Number(r.id),
    trigger: r.trigger,
    startedAt: r.started_at,
    rcaDueAt: r.rca_due_at,
    verdict: r.verdict,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    note: r.note,
  }));
}

/** Five working days from now, skipping Saturday and Sunday. */
export function rcaDueDate(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < 5) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

/** Starts a pause, unless one is already open. */
export async function startPause(trigger: string): Promise<Pause | null> {
  const existing = await currentPause();
  if (existing && existing.verdict === null) return existing;

  const [row] = await query<{ id: string }>(
    "INSERT INTO pauses (trigger, started_at, rca_due_at) VALUES ($1, now(), $2) RETURNING id",
    [trigger, rcaDueDate().toISOString()],
  );
  void row;
  return await currentPause();
}

/**
 * The rejection rate of the last two completed reviews, newest first.
 * A review counts as completed once it has been exported.
 */
export async function lastTwoReviewRates(): Promise<{ runId: string; rate: number | null; decided: number }[]> {
  const rows = await query<{
    run_id: string; accepted: string; changed: string; rejected: string;
  }>(
    `SELECT r.run_id,
            count(*) FILTER (WHERE d.action = 'accept') AS accepted,
            count(*) FILTER (WHERE d.action = 'change') AS changed,
            count(*) FILTER (WHERE d.action = 'reject') AS rejected
       FROM recommendations r
       JOIN decisions d ON d.recommendation_id = r.id
       JOIN runs ru ON ru.id = r.run_id
      WHERE r.is_exception = false AND ru.review_ended_at IS NOT NULL
      GROUP BY r.run_id, ru.review_ended_at
      ORDER BY ru.review_ended_at DESC
      LIMIT 2`,
  );
  return rows.map((r) => {
    const counts = {
      accepted: Number(r.accepted),
      changed: Number(r.changed),
      rejected: Number(r.rejected),
    };
    return {
      runId: r.run_id,
      rate: rejectionRate(counts),
      decided: counts.accepted + counts.changed + counts.rejected,
    };
  });
}

export type PauseCheck = {
  paused: boolean;
  alert: boolean;
  reason: string;
  rates: { runId: string; rate: number | null }[];
};

/**
 * Checked after a review is exported. Does not pause on its own in shadow
 * phase, and never pauses on one bad review: two consecutive reviews, as
 * specified, so a single awkward week does not stop the pilot.
 */
export async function checkRejectionPause(phase: Phase, pauseAbove: number | null, alertAbove: number | null): Promise<PauseCheck> {
  const rates = await lastTwoReviewRates();
  const simple = rates.map((r) => ({ runId: r.runId, rate: r.rate }));

  // The alert is about one review, the pause about two consecutive ones.
  // They are judged separately: a single bad review is exactly when Deepa
  // most wants to know, and that is the case where there is no second one
  // to pair it with.
  const newest = rates[0]?.rate ?? null;
  const shouldAlert = alertAbove !== null && newest !== null && newest > alertAbove;
  const alertLine =
    shouldAlert && alertAbove !== null
      ? ` The last review was ${(newest * 100).toFixed(0)}%, above the ${(alertAbove * 100).toFixed(0)}% alert line, so Deepa should look.`
      : "";

  if (pauseAbove === null) {
    return {
      paused: false,
      alert: shouldAlert,
      reason: `${phase} phase does not pause on rejections.${alertLine}`,
      rates: simple,
    };
  }
  if (rates.length < 2) {
    return {
      paused: false,
      alert: shouldAlert,
      reason: `Only ${rates.length} completed review so far; a pause needs two consecutive reviews above the limit.${alertLine}`,
      rates: simple,
    };
  }

  const both = rates.every((r) => r.rate !== null && r.rate > pauseAbove);
  if (both) {
    const pct = (pauseAbove * 100).toFixed(0);
    await startPause(
      // Oldest first, because "X then Y" reads as a sequence and `rates`
      // comes back newest first.
      `Rejections above ${pct}% in two consecutive reviews (${[...rates]
        .reverse()
        .map((r) => `${((r.rate ?? 0) * 100).toFixed(0)}%`)
        .join(" then ")}), ${phase} phase`,
    );
    return { paused: true, alert: false, reason: `Paused: two consecutive reviews above ${pct}%.`, rates: simple };
  }

  if (shouldAlert) {
    return {
      paused: false,
      alert: true,
      reason: `Nothing is paused: only one of the last two reviews is above the ${(pauseAbove * 100).toFixed(0)}% limit.${alertLine}`,
      rates: simple,
    };
  }
  return { paused: false, alert: false, reason: "Within the limits for this phase.", rates: simple };
}

// ------------------------------------------------------------ harm events

export type HarmEvent = {
  id: number;
  skuId: string | null;
  valueInr: number;
  recordedBy: string;
  at: Date;
  note: string | null;
};

export async function harmEvents(): Promise<HarmEvent[]> {
  const rows = await query<{
    id: string; sku_id: string | null; value_inr: string; recorded_by: string; at: Date; note: string | null;
  }>("SELECT * FROM harm_events ORDER BY at DESC LIMIT 25");
  return rows.map((r) => ({
    id: Number(r.id),
    skuId: r.sku_id,
    valueInr: Number(r.value_inr),
    recordedBy: r.recorded_by,
    at: r.at,
    note: r.note,
  }));
}

/**
 * The app has no prices, so harm is recorded by a person with a rupee value.
 * Above Rs 2L on one SKU it suspends immediately, in any phase, including
 * shadow: that threshold is not about confidence in the rules, it is about
 * a loss that has already happened.
 */
export async function recordHarmEvent(args: {
  skuId: string | null;
  valueInr: number;
  recordedBy: string;
  note: string | null;
}): Promise<{ paused: boolean }> {
  const paused = args.valueInr > HARM_EVENT_PAUSE_INR;
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO harm_events (sku_id, value_inr, recorded_by, note) VALUES ($1, $2, $3, $4)",
      [args.skuId, args.valueInr, args.recordedBy, args.note],
    );
  });
  if (paused) {
    await startPause(
      `Harm event of Rs ${args.valueInr.toLocaleString("en-IN")}${args.skuId ? ` on ${args.skuId}` : ""}, above the Rs ${HARM_EVENT_PAUSE_INR.toLocaleString("en-IN")} limit`,
    );
  }
  return { paused };
}

// ------------------------------------------------------------------- RCA

/** Deepa's verdict. A note is required, and the database enforces that too. */
export async function recordVerdict(args: {
  pauseId: number;
  verdict: Verdict;
  note: string;
  decidedBy: string;
}): Promise<void> {
  await query(
    `UPDATE pauses SET verdict = $2, note = $3, decided_at = now(), decided_by = $4
      WHERE id = $1 AND verdict IS NULL`,
    [args.pauseId, args.verdict, args.note, args.decidedBy],
  );
}
