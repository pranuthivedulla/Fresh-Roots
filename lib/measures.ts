/**
 * The measures from section 5. Every one is computed from what the app
 * recorded as it happened, never from anyone's recollection.
 *
 * Where a measure cannot be computed yet, it returns null and the screen says
 * why. A measure with no data is not zero, and showing 0% adherence before
 * anyone has reviewed anything would be a lie that looks like a fact.
 */

import { query } from "./db.ts";
import { rejectionRate } from "./phase.ts";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./settings.ts";
import { daysBetween, monthKey, type CalendarDate } from "./time.ts";

export type Measure = {
  name: string;
  /** Null when there is nothing to measure yet. */
  value: string | null;
  /** What it is counted over, so a percentage is never read without its base. */
  basis: string;
  /** Said plainly, because a number nobody understands is not a measure. */
  note: string;
};

function toCalendarDate(d: Date): CalendarDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Zoho send time minus the stock as-of date. The lead indicator. */
export async function forecastAgeAtOrder(): Promise<Measure> {
  const rows = await query<{ as_of_date: Date; sent_confirmed_at: Date }>(
    `SELECT l.as_of_date, e.sent_confirmed_at
       FROM exports e
       JOIN runs r ON r.id = e.run_id
       JOIN loads l ON l.id = r.load_id
      WHERE e.sent_confirmed_at IS NOT NULL
      ORDER BY e.sent_confirmed_at DESC
      LIMIT 20`,
  );
  if (rows.length === 0) {
    return {
      name: "Forecast age at order",
      value: null,
      basis: "no list has been confirmed as sent yet",
      note: "Days between the stock snapshot and the moment Raghav confirms he sent the list. This is the lead indicator: it should fall as the cycle gets shorter.",
    };
  }
  const ages = rows.map((r) => daysBetween(toCalendarDate(r.as_of_date), toCalendarDate(r.sent_confirmed_at)));
  const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
  return {
    name: "Forecast age at order",
    value: `${mean.toFixed(1)} days (latest ${ages[0]})`,
    basis: `${rows.length} confirmed send${rows.length === 1 ? "" : "s"}`,
    note: "Days between the stock snapshot and the moment Raghav confirms he sent the list.",
  };
}

/** Runs per calendar month, IST. The target is twice a week. */
export async function cyclesPerMonth(): Promise<Measure> {
  const rows = await query<{ run_at: Date }>("SELECT run_at FROM runs ORDER BY run_at DESC LIMIT 200");
  if (rows.length === 0) {
    return { name: "Forecast cycles per month", value: null, basis: "no runs yet", note: "Monthly today; the target is twice a week, which is about 8 or 9 a month." };
  }
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(toCalendarDate(r.run_at));
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return {
    name: "Forecast cycles per month",
    value: months.map(([m, n]) => `${m}: ${n}`).join(", "),
    basis: `${rows.length} run${rows.length === 1 ? "" : "s"}`,
    note: "Monthly today; the target is twice a week, which is about 8 or 9 a month.",
  };
}

/** Review screen open to export. Raghav's hands-on time per run. */
export async function minutesPerRun(): Promise<Measure> {
  const rows = await query<{ minutes: string }>(
    `SELECT EXTRACT(EPOCH FROM (review_ended_at - review_started_at)) / 60 AS minutes
       FROM runs
      WHERE review_started_at IS NOT NULL AND review_ended_at IS NOT NULL
      ORDER BY run_at DESC LIMIT 20`,
  );
  if (rows.length === 0) {
    return { name: "Minutes per run", value: null, basis: "no review has been completed yet", note: "From opening the review to exporting. Not the whole of Raghav's time: the export from SAP and the typing into Zoho sit outside the app." };
  }
  const mins = rows.map((r) => Number(r.minutes));
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  return {
    name: "Minutes per run",
    value: `${mean.toFixed(1)} min (latest ${mins[0]!.toFixed(1)})`,
    basis: `${rows.length} completed review${rows.length === 1 ? "" : "s"}`,
    note: "From opening the review to exporting. Not the whole of Raghav's time: the SAP export and the Zoho entry sit outside the app.",
  };
}

/** Rejections and changes over rule-covered recommendations. Feeds the pause rules. */
export async function rejectionRateMeasure(): Promise<Measure> {
  const [row] = await query<{ accepted: string; changed: string; rejected: string }>(
    `SELECT count(*) FILTER (WHERE d.action = 'accept') AS accepted,
            count(*) FILTER (WHERE d.action = 'change') AS changed,
            count(*) FILTER (WHERE d.action = 'reject') AS rejected
       FROM decisions d
       JOIN recommendations r ON r.id = d.recommendation_id
      WHERE r.is_exception = false`,
  );
  const counts = {
    accepted: Number(row?.accepted ?? 0),
    changed: Number(row?.changed ?? 0),
    rejected: Number(row?.rejected ?? 0),
  };
  const rate = rejectionRate(counts);
  return {
    name: "Rejection rate",
    value: rate === null ? null : `${(rate * 100).toFixed(0)}%`,
    basis:
      rate === null
        ? "no decisions yet"
        : `${counts.changed + counts.rejected} of ${counts.accepted + counts.changed + counts.rejected} rule-covered recommendations`,
    note: "Changes count as rejections: the number the app produced was not the number used. Exceptions are excluded, because they carry no recommendation to reject.",
  };
}

/** Exceptions over all SKUs evaluated. Expected around 15-20%. */
export async function exceptionShare(): Promise<Measure> {
  const [row] = await query<{ exceptions: string; total: string }>(
    "SELECT count(*) FILTER (WHERE is_exception) AS exceptions, count(*) AS total FROM recommendations",
  );
  const exceptions = Number(row?.exceptions ?? 0);
  const total = Number(row?.total ?? 0);
  return {
    name: "Exception share",
    value: total === 0 ? null : `${((exceptions / total) * 100).toFixed(0)}%`,
    basis: total === 0 ? "nothing evaluated yet" : `${exceptions} of ${total} SKUs evaluated`,
    note: "SKUs the rules would not put a number against. Expected around 15-20%; much lower may mean the gates are too loose.",
  };
}

/** Reviews finished on the same IST day as the run. */
export async function reviewAdherence(): Promise<Measure> {
  const [row] = await query<{ same_day: string; total: string }>(
    `SELECT count(*) FILTER (
              WHERE review_ended_at IS NOT NULL
                AND (review_ended_at AT TIME ZONE 'Asia/Kolkata')::date = (run_at AT TIME ZONE 'Asia/Kolkata')::date
            ) AS same_day,
            count(*) AS total
       FROM runs`,
  );
  const sameDay = Number(row?.same_day ?? 0);
  const total = Number(row?.total ?? 0);
  return {
    name: "Review adherence",
    value: total === 0 ? null : `${((sameDay / total) * 100).toFixed(0)}%`,
    basis: total === 0 ? "no runs yet" : `${sameDay} of ${total} runs reviewed the same day`,
    note: "A draft list reviewed days later is a stale draft list. Run days are not yet a setting, so this counts same-day rather than on-a-run-day.",
  };
}

/**
 * Rule fidelity: does every stored recommendation still match what the rules
 * produce from the numbers stored beside it?
 *
 * This is the shadow-phase gate, and it is a backtest, not a re-run: it uses
 * the cover and averages recorded at the time, so it tests the rules against
 * themselves rather than against data that has since moved.
 */
export async function ruleFidelity(thresholds: Thresholds = DEFAULT_THRESHOLDS): Promise<Measure & { mismatches: string[] }> {
  const rows = await query<{
    sku_id: string; perishability: "Low" | "High"; cover: string | null;
    flag: string | null; qty: number | null; standard_reorder_qty: number;
    avg12: string | null; avg4: string | null; is_exception: boolean;
  }>(
    `SELECT r.sku_id, m.perishability, r.cover, r.flag, r.qty, m.standard_reorder_qty,
            r.avg12, r.avg4, r.is_exception
       FROM recommendations r JOIN sku_master m ON m.sku_id = r.sku_id
      WHERE r.is_exception = false`,
  );
  if (rows.length === 0) {
    return {
      name: "Rule fidelity",
      value: null,
      basis: "nothing to backtest yet",
      note: "Every stored recommendation re-checked against the rules, using the numbers recorded with it. The shadow-phase gate is 100%.",
      mismatches: [],
    };
  }

  const mismatches: string[] = [];
  for (const r of rows) {
    const cover = r.cover === null ? null : Number(r.cover);
    if (cover === null) continue;
    const limits = r.perishability === "High" ? thresholds.perishable : thresholds.standard;
    const expectedFlag =
      cover < limits.stockoutUnder ? "stockout" : cover > limits.overstockOver ? "overstock" : "in-range";
    if (r.flag !== expectedFlag) {
      mismatches.push(`${r.sku_id}: stored ${r.flag}, rules say ${expectedFlag} at ${cover.toFixed(2)} weeks`);
      continue;
    }
    const avg12 = r.avg12 === null ? null : Number(r.avg12);
    const avg4 = r.avg4 === null ? null : Number(r.avg4);
    const highDemand =
      avg12 !== null && avg4 !== null && avg12 > 0 && avg4 > avg12 * (1 + thresholds.highDemandAbovePct / 100);
    const expectedQty =
      expectedFlag === "stockout"
        ? highDemand
          ? Math.round(Number(r.standard_reorder_qty) * thresholds.highDemandMultiplier)
          : Number(r.standard_reorder_qty)
        : 0;
    if (Number(r.qty ?? 0) !== expectedQty) {
      mismatches.push(`${r.sku_id}: stored quantity ${r.qty}, rules say ${expectedQty}`);
    }
  }

  const pct = ((rows.length - mismatches.length) / rows.length) * 100;
  return {
    name: "Rule fidelity",
    value: `${pct.toFixed(0)}%`,
    basis: `${rows.length - mismatches.length} of ${rows.length} recommendations match`,
    note:
      mismatches.length === 0
        ? "Every stored recommendation still matches the rules. The shadow-phase gate is 100%."
        : "A mismatch means a recommendation was stored that the current rules would not produce. Either a threshold changed after the run, or something is wrong.",
    mismatches,
  };
}

/**
 * What happened to each rejected or changed recommendation by the next load
 * at least two weeks later.
 *
 * Outcome rule: stockout if cover was below the stockout limit at that later
 * snapshot, overstock if above the overstock limit, otherwise neither. This
 * is shown beside Deepa's verdict so a restart decision rests on evidence
 * rather than on how the last review felt.
 */
export type Outcome = {
  skuId: string;
  action: "change" | "reject";
  reasonCode: string | null;
  recommendedQty: number | null;
  finalQty: number | null;
  outcome: "stockout" | "overstock" | "neither" | "not yet";
  laterCover: number | null;
  laterAsOf: CalendarDate | null;
};

export async function laterOutcomes(thresholds: Thresholds = DEFAULT_THRESHOLDS): Promise<Outcome[]> {
  const rows = await query<{
    sku_id: string; action: "change" | "reject"; reason_code: string | null;
    qty: number | null; final_qty: number | null; perishability: "Low" | "High";
    as_of_date: Date; avg12: string | null; uplift_applied: string;
  }>(
    `SELECT r.sku_id, d.action, d.reason_code, r.qty, d.final_qty, m.perishability,
            l.as_of_date, r.avg12, r.uplift_applied
       FROM decisions d
       JOIN recommendations r ON r.id = d.recommendation_id
       JOIN runs ru ON ru.id = r.run_id
       JOIN loads l ON l.id = ru.load_id
       JOIN sku_master m ON m.sku_id = r.sku_id
      WHERE d.action IN ('change', 'reject') AND r.is_exception = false
      ORDER BY d.decided_at DESC`,
  );

  const out: Outcome[] = [];
  for (const r of rows) {
    const decidedAsOf = toCalendarDate(r.as_of_date);
    const [later] = await query<{ units_on_hand: number; as_of_date: Date }>(
      `SELECT units_on_hand, as_of_date FROM stock_snapshots
        WHERE sku_id = $1 AND as_of_date >= $2::date + INTERVAL '14 days'
        ORDER BY as_of_date ASC LIMIT 1`,
      [r.sku_id, `${decidedAsOf.year}-${String(decidedAsOf.month).padStart(2, "0")}-${String(decidedAsOf.day).padStart(2, "0")}`],
    );

    const base: Omit<Outcome, "outcome" | "laterCover" | "laterAsOf"> = {
      skuId: r.sku_id,
      action: r.action,
      reasonCode: r.reason_code,
      recommendedQty: r.qty === null ? null : Number(r.qty),
      finalQty: r.final_qty === null ? null : Number(r.final_qty),
    };

    const demand = r.avg12 === null ? null : Number(r.avg12) * Number(r.uplift_applied);
    if (!later || demand === null || demand <= 0) {
      out.push({ ...base, outcome: "not yet", laterCover: null, laterAsOf: null });
      continue;
    }
    const cover = Number(later.units_on_hand) / demand;
    const limits = r.perishability === "High" ? thresholds.perishable : thresholds.standard;
    out.push({
      ...base,
      outcome: cover < limits.stockoutUnder ? "stockout" : cover > limits.overstockOver ? "overstock" : "neither",
      laterCover: cover,
      laterAsOf: toCalendarDate(later.as_of_date),
    });
  }
  return out;
}

/** Rejections grouped by the rule that produced them and by month. */
export async function rejectionsByRuleAndMonth(): Promise<
  { month: string; rule: string; action: string; reasonCode: string | null; count: number }[]
> {
  const rows = await query<{
    month: string; rule: string; action: string; reason_code: string | null; n: string;
  }>(
    `SELECT to_char(d.decided_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
            COALESCE(
              (SELECT jsonb_array_elements(r.rules_fired) ->> 'rule'
                 WHERE jsonb_array_length(r.rules_fired) > 0
                 LIMIT 1),
              'unknown') AS rule,
            d.action, d.reason_code, count(*) AS n
       FROM decisions d
       JOIN recommendations r ON r.id = d.recommendation_id
      WHERE d.action IN ('change','reject')
      GROUP BY 1, 2, 3, 4
      ORDER BY 1 DESC, 5 DESC`,
  );
  return rows.map((r) => ({
    month: r.month,
    rule: r.rule,
    action: r.action,
    reasonCode: r.reason_code,
    count: Number(r.n),
  }));
}
