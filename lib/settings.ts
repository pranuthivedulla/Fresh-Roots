/**
 * Every number the five rules and the ingest gates use, in one place.
 *
 * These belong to Deepa (admin passcode, `settings` table). Nothing else in the
 * codebase may hard-code one of these values, and Raghav may not edit them.
 * The defaults below are the locked rule sheet from nine-checks.md.
 */

export type Thresholds = {
  /** Perishability = Low. Weeks of cover. */
  standard: { stockoutUnder: number; overstockOver: number };
  /** Perishability = High. */
  perishable: { stockoutUnder: number; overstockOver: number };
  /** Rule 4: avg4 more than this percent above avg12 makes a SKU high-demand. */
  highDemandAbovePct: number;
  /** Rule 4: recommended quantity multiplier for a high-demand SKU. */
  highDemandMultiplier: number;
  /** Rule 5: demand uplift in a festival month, as a percent. Never stacks with rule 4. */
  festivalUpliftPct: number;
  /** Weeks in the cover window. Less history than this is an exception. */
  coverWindowWeeks: number;
  /** Weeks in the recent window used by rule 4. */
  recentWindowWeeks: number;
  /** A week above this multiple of the window median is an outlier exception. */
  outlierMultipleOfMedian: number;
  /** Stock as-of date older than this many days: warn. */
  staleWarnDays: number;
  /** Stock as-of date older than this many days: block the run. */
  staleBlockDays: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  standard: { stockoutUnder: 6, overstockOver: 14 },
  perishable: { stockoutUnder: 3, overstockOver: 4 },
  highDemandAbovePct: 20,
  highDemandMultiplier: 1.5,
  festivalUpliftPct: 25,
  coverWindowWeeks: 12,
  recentWindowWeeks: 4,
  outlierMultipleOfMedian: 2,
  staleWarnDays: 3,
  staleBlockDays: 7,
};
