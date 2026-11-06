/**
 * The thresholds as Deepa has them set, not as they were compiled.
 *
 * lib/settings.ts holds the defaults and the shape. This reads and writes the
 * live values from the settings table, so changing a limit is a setting
 * change with a logged author and time, not a deploy.
 *
 * A stored value that cannot be read falls back to the default and says so,
 * rather than failing a run: a corrupt setting must not stop Raghav working.
 */

import { getSetting, setSetting } from "./repo.ts";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./settings.ts";

export const THRESHOLDS_KEY = "thresholds";

export type LoadedThresholds = {
  thresholds: Thresholds;
  /** True when these are the compiled defaults, not something Deepa set. */
  usingDefaults: boolean;
  /** Set when a stored value existed but could not be used. */
  problem: string | null;
};

export async function loadThresholds(): Promise<LoadedThresholds> {
  let raw: string | null = null;
  try {
    raw = await getSetting(THRESHOLDS_KEY);
  } catch {
    return { thresholds: DEFAULT_THRESHOLDS, usingDefaults: true, problem: "the settings table could not be read" };
  }
  if (!raw || raw.trim() === "") {
    return { thresholds: DEFAULT_THRESHOLDS, usingDefaults: true, problem: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Thresholds>;
    const merged = mergeWithDefaults(parsed);
    const invalid = validate(merged);
    if (invalid) {
      return { thresholds: DEFAULT_THRESHOLDS, usingDefaults: true, problem: invalid };
    }
    return { thresholds: merged, usingDefaults: false, problem: null };
  } catch {
    return { thresholds: DEFAULT_THRESHOLDS, usingDefaults: true, problem: "the stored thresholds are not readable" };
  }
}

export async function saveThresholds(next: Thresholds, changedBy: string): Promise<string | null> {
  const invalid = validate(next);
  if (invalid) return invalid;
  await setSetting(THRESHOLDS_KEY, JSON.stringify(next), changedBy);
  return null;
}

function mergeWithDefaults(p: Partial<Thresholds>): Thresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...p,
    standard: { ...DEFAULT_THRESHOLDS.standard, ...(p.standard ?? {}) },
    perishable: { ...DEFAULT_THRESHOLDS.perishable, ...(p.perishable ?? {}) },
  };
}

/** Returns a sentence saying what is wrong, or null. */
export function validate(t: Thresholds): string | null {
  const positive = (n: unknown, name: string) =>
    typeof n !== "number" || !Number.isFinite(n) || n <= 0 ? `${name} must be a number above zero.` : null;

  for (const [n, name] of [
    [t.standard.stockoutUnder, "the standard stockout limit"],
    [t.standard.overstockOver, "the standard overstock limit"],
    [t.perishable.stockoutUnder, "the perishable stockout limit"],
    [t.perishable.overstockOver, "the perishable overstock limit"],
    [t.highDemandMultiplier, "the high-demand multiplier"],
    [t.coverWindowWeeks, "the cover window"],
    [t.recentWindowWeeks, "the recent window"],
    [t.outlierMultipleOfMedian, "the outlier multiple"],
    [t.staleBlockDays, "the block-after days"],
  ] as const) {
    const bad = positive(n, name);
    if (bad) return bad;
  }
  if (t.standard.stockoutUnder >= t.standard.overstockOver) {
    return "The standard stockout limit must be below the standard overstock limit, or every SKU is flagged twice.";
  }
  if (t.perishable.stockoutUnder >= t.perishable.overstockOver) {
    return "The perishable stockout limit must be below the perishable overstock limit.";
  }
  if (t.recentWindowWeeks >= t.coverWindowWeeks) {
    return "The recent window must be shorter than the cover window; rule 4 compares one against the other.";
  }
  if (t.staleWarnDays >= t.staleBlockDays) {
    return "The warn-after days must be fewer than the block-after days.";
  }
  if (t.highDemandAbovePct < 0 || t.festivalUpliftPct < 0) {
    return "Percentages cannot be negative.";
  }
  if (t.outlierMultipleOfMedian <= 1) {
    return "The outlier multiple must be above 1, or every week counts as an outlier.";
  }
  return null;
}
