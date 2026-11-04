/**
 * The five rules. Plain code, no AI, no inference.
 *
 *  1. Weeks of cover = (on hand + on order) / demand, demand = avg12 unless 4 or 5 change it.
 *  2. Standard (Perishability = Low):  stockout under 6 weeks, overstock over 14.
 *  3. Perishable (Perishability = High): stockout under 3 weeks, overstock over 4.
 *  4. High-demand: avg4 more than 20% above avg12 -> quantity is 1.5x the standard reorder qty.
 *  5. Festival month: demand = avg12 x 1.25 for the cover calculation.
 *
 * No stacking: a high-demand SKU uses plain avg12 for cover (no festival uplift)
 * and takes the 1.5x on quantity. The uplift applies only to SKUs that are not
 * high-demand.
 *
 * Every number used is returned, so the "why" drawer and Deepa's RCA can show
 * the arithmetic rather than a verdict.
 */

import { DEFAULT_THRESHOLDS, type Thresholds } from "./settings.ts";
import { compareIsoWeeks, monthKey, type CalendarDate } from "./time.ts";
import type { CalendarMonth, Dataset, Sku, WeeklySale } from "./types.ts";

export type Flag = "stockout" | "overstock" | "in-range";

/** Which of the five rules fired, and what it did. Written to recommendations.rules_fired. */
export type RuleFired = { rule: string; detail: string };

export type ExceptionReason =
  | { kind: "short-history"; weeksFound: number; weeksRequired: number }
  | { kind: "outlier-week"; weekLabel: string; units: number; median: number; multiple: number }
  | { kind: "unknown-stock" }
  | { kind: "zero-demand" }
  | { kind: "manual"; movedBy: string; note: string };

/** The numbers behind one SKU's evaluation. Nulls mean "not computable", never zero. */
export type Numbers = {
  weeksOfHistory: number;
  avg12: number | null;
  avg4: number | null;
  medianOfWindow: number | null;
  unitsOnHand: number | null;
  onOrder: number;
  isHighDemand: boolean;
  isFestivalMonth: boolean;
  upliftApplied: number; // 1 = none, 1.25 = festival uplift
  demandUsed: number | null;
  cover: number | null;
};

export type Evaluation = {
  skuId: string;
  sku: Sku;
  numbers: Numbers;
  rulesFired: RuleFired[];
  /** The window the averages were taken over, oldest first. For the why drawer. */
  window: WeeklySale[];
} & (
  | {
      isException: true;
      exceptionReasons: ExceptionReason[];
      flag: null;
      recommendedQty: null;
      recommendation: null;
    }
  | {
      isException: false;
      exceptionReasons: [];
      flag: Flag;
      /** Units to order. 0 on an overstock hold, 0 when in range. */
      recommendedQty: number;
      recommendation: "order" | "hold" | "none";
    }
);

export type RunInput = {
  dataset: Dataset;
  /** Required per SKU. A missing entry is an ingest-level block, not a zero. */
  onOrder: Map<string, number>;
  /** The date the run is made for, in IST. Decides the festival month. */
  runDate: CalendarDate;
  thresholds?: Thresholds;
  /** SKUs Raghav moved into the queue by hand. */
  manualExceptions?: Map<string, { movedBy: string; note: string }>;
};

export type RunResult = {
  evaluations: Evaluation[];
  festivalMonth: boolean;
  counts: { stockout: number; overstock: number; inRange: number; exceptions: number };
};

export function runRules(input: RunInput): RunResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { dataset } = input;
  const festivalMonth = isFestivalMonth(dataset.calendar, input.runDate);
  const salesBySku = groupSales(dataset.sales);
  const stockBySku = new Map(dataset.stock.map((s) => [s.skuId, s.unitsOnHand]));

  const evaluations = dataset.skus.map((sku) =>
    evaluateSku({
      sku,
      sales: salesBySku.get(sku.skuId) ?? [],
      unitsOnHand: stockBySku.has(sku.skuId) ? stockBySku.get(sku.skuId)! : null,
      onOrder: input.onOrder.get(sku.skuId),
      festivalMonth,
      thresholds: t,
      manual: input.manualExceptions?.get(sku.skuId),
    }),
  );

  const counts = {
    stockout: evaluations.filter((e) => !e.isException && e.flag === "stockout").length,
    overstock: evaluations.filter((e) => !e.isException && e.flag === "overstock").length,
    inRange: evaluations.filter((e) => !e.isException && e.flag === "in-range").length,
    exceptions: evaluations.filter((e) => e.isException).length,
  };
  return { evaluations, festivalMonth, counts };
}

function evaluateSku(args: {
  sku: Sku;
  sales: WeeklySale[];
  unitsOnHand: number | null;
  onOrder: number | undefined;
  festivalMonth: boolean;
  thresholds: Thresholds;
  manual?: { movedBy: string; note: string };
}): Evaluation {
  const { sku, thresholds: t } = args;
  if (args.onOrder === undefined) {
    // runRules must not be reached with a blank on-order cell; ingest blocks it.
    throw new Error(
      `on-order is missing for ${sku.skuId}. A blank on-order cell blocks the run; it is never read as zero.`,
    );
  }
  const onOrder = args.onOrder;

  const history = [...args.sales].sort((a, b) => compareIsoWeeks(a.weekLabel, b.weekLabel));
  const window = history.slice(-t.coverWindowWeeks);
  const recent = history.slice(-t.recentWindowWeeks);

  const reasons: ExceptionReason[] = [];
  const rulesFired: RuleFired[] = [];

  if (args.manual) {
    reasons.push({ kind: "manual", movedBy: args.manual.movedBy, note: args.manual.note });
  }

  if (window.length < t.coverWindowWeeks) {
    reasons.push({
      kind: "short-history",
      weeksFound: window.length,
      weeksRequired: t.coverWindowWeeks,
    });
  }
  if (args.unitsOnHand === null) {
    reasons.push({ kind: "unknown-stock" });
  }

  const avg12 = window.length > 0 ? mean(window.map((w) => w.units)) : null;
  const avg4 = recent.length > 0 ? mean(recent.map((w) => w.units)) : null;
  const medianOfWindow = window.length > 0 ? median(window.map((w) => w.units)) : null;

  // Outlier: any week in the window above the multiple of that window's median.
  // Not cleaned, not dropped. Shown to Raghav with the week named.
  if (medianOfWindow !== null && medianOfWindow > 0) {
    for (const w of window) {
      if (w.units > t.outlierMultipleOfMedian * medianOfWindow) {
        reasons.push({
          kind: "outlier-week",
          weekLabel: w.weekLabel,
          units: w.units,
          median: medianOfWindow,
          multiple: w.units / medianOfWindow,
        });
      }
    }
  }

  const isHighDemand =
    avg12 !== null && avg4 !== null && avg12 > 0 && avg4 > avg12 * (1 + t.highDemandAbovePct / 100);

  // Rule 5 only applies to SKUs that are not high-demand. Logged either way,
  // because "the uplift was withheld" is itself a decision Deepa must be able to see.
  const upliftApplies = args.festivalMonth && !isHighDemand;
  const upliftApplied = upliftApplies ? 1 + t.festivalUpliftPct / 100 : 1;

  if (avg12 !== null && avg12 === 0) {
    reasons.push({ kind: "zero-demand" });
  }

  const demandUsed = avg12 !== null && avg12 > 0 ? avg12 * upliftApplied : null;
  const cover =
    demandUsed !== null && args.unitsOnHand !== null
      ? (args.unitsOnHand + onOrder) / demandUsed
      : null;

  const numbers: Numbers = {
    weeksOfHistory: history.length,
    avg12,
    avg4,
    medianOfWindow,
    unitsOnHand: args.unitsOnHand,
    onOrder,
    isHighDemand,
    isFestivalMonth: args.festivalMonth,
    upliftApplied,
    demandUsed,
    cover,
  };

  if (reasons.length > 0 || cover === null) {
    if (cover === null && reasons.length === 0) {
      // Defensive: cover should only be null for a reason already recorded.
      reasons.push({ kind: "zero-demand" });
    }
    return {
      skuId: sku.skuId,
      sku,
      numbers,
      rulesFired,
      window,
      isException: true,
      exceptionReasons: reasons,
      flag: null,
      recommendedQty: null,
      recommendation: null,
    };
  }

  const limits = sku.perishability === "High" ? t.perishable : t.standard;
  rulesFired.push({
    rule: "rule-1-weeks-of-cover",
    detail: `(${args.unitsOnHand} on hand + ${onOrder} on order) / ${round(demandUsed!, 2)} per week = ${round(cover, 2)} weeks`,
  });
  rulesFired.push({
    rule: sku.perishability === "High" ? "rule-3-perishable-thresholds" : "rule-2-standard-thresholds",
    detail: `stockout under ${limits.stockoutUnder} weeks, overstock over ${limits.overstockOver} weeks`,
  });
  if (isHighDemand) {
    rulesFired.push({
      rule: "rule-4-high-demand",
      detail: `last ${t.recentWindowWeeks} weeks average ${round(avg4!, 2)} is ${round(((avg4! - avg12!) / avg12!) * 100, 1)}% above the ${t.coverWindowWeeks}-week average ${round(avg12!, 2)}, so quantity is ${t.highDemandMultiplier}x`,
    });
  }
  if (args.festivalMonth) {
    rulesFired.push(
      upliftApplies
        ? {
            rule: "rule-5-festival-uplift",
            detail: `festival month, so demand = ${round(avg12!, 2)} x ${1 + t.festivalUpliftPct / 100} = ${round(demandUsed!, 2)}`,
          }
        : {
            rule: "rule-5-festival-uplift-withheld",
            detail: `festival month, but this SKU is high-demand, so the uplift does not stack; demand stays at ${round(avg12!, 2)}`,
          },
    );
  }

  const flag: Flag =
    cover < limits.stockoutUnder ? "stockout" : cover > limits.overstockOver ? "overstock" : "in-range";

  let recommendedQty = 0;
  let recommendation: "order" | "hold" | "none" = "none";
  if (flag === "stockout") {
    recommendation = "order";
    recommendedQty = isHighDemand
      ? Math.round(sku.standardReorderQty * t.highDemandMultiplier)
      : sku.standardReorderQty;
  } else if (flag === "overstock") {
    recommendation = "hold";
    recommendedQty = 0;
  }

  return {
    skuId: sku.skuId,
    sku,
    numbers,
    rulesFired,
    window,
    isException: false,
    exceptionReasons: [],
    flag,
    recommendedQty,
    recommendation,
  };
}

export function isFestivalMonth(calendar: CalendarMonth[], date: CalendarDate): boolean {
  const key = monthKey(date);
  const row = calendar.find((c) => monthKey({ year: c.year, month: c.month, day: 1 }) === key);
  // Off the end of the calendar file is not "no festival"; it is unknown.
  // The ingest gate warns; the rules treat an absent month as not a festival
  // month, and the run banner says the calendar ends when it does.
  return row?.isFestivalMonth ?? false;
}

export function calendarCovers(calendar: CalendarMonth[], date: CalendarDate): boolean {
  const key = monthKey(date);
  return calendar.some((c) => monthKey({ year: c.year, month: c.month, day: 1 }) === key);
}

function groupSales(sales: WeeklySale[]): Map<string, WeeklySale[]> {
  const out = new Map<string, WeeklySale[]>();
  for (const s of sales) {
    const list = out.get(s.skuId);
    if (list) list.push(s);
    else out.set(s.skuId, [s]);
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Half away from zero, the way a person rounds. */
export function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
