/**
 * Which phase the pilot is in, and what that means for pausing.
 *
 *   Shadow  weeks 1-3   runs beside Raghav's manual process. No pause on
 *                       rejections. Gate: rule fidelity 100% on the backtest.
 *   Tuning  weeks 4-8   pause above 75% rejections in 2 consecutive reviews.
 *                       Above 50%, alert Deepa only.
 *   Steady  week 9+     pause above 25% in 2 consecutive reviews.
 *   Always              a recorded harm event over Rs 2L on one SKU pauses
 *                       immediately, in every phase.
 *
 * Phase comes from the go_live_date setting, which only Deepa can change.
 * With no go-live date there is no phase yet, and the app treats the pilot as
 * not started: shadow, the most cautious of the three.
 */

import { daysBetween, type CalendarDate } from "./time.ts";

export type Phase = "shadow" | "tuning" | "steady";

export const HARM_EVENT_PAUSE_INR = 200_000;

export type PhaseRules = {
  phase: Phase;
  /** Week of the pilot, 1-based. Null when there is no go-live date. */
  week: number | null;
  /** Rejection rate above this, in 2 consecutive reviews, pauses. Null = never. */
  pauseAbove: number | null;
  /** Rejection rate above this alerts Deepa without pausing. Null = no alert. */
  alertAbove: number | null;
  /** Said on screen, in words, so nobody has to remember the table. */
  summary: string;
};

export function phaseFor(goLiveDate: CalendarDate | null, today: CalendarDate): PhaseRules {
  if (!goLiveDate) {
    return {
      phase: "shadow",
      week: null,
      pauseAbove: null,
      alertAbove: null,
      summary:
        "No go-live date is set, so the pilot has not started. Treated as shadow: the app runs beside the manual process and never pauses on rejections.",
    };
  }
  const days = daysBetween(goLiveDate, today);
  // Day 0 is week 1. Before go-live is also week 1: nothing has run yet.
  const week = days < 0 ? 1 : Math.floor(days / 7) + 1;

  if (week <= 3) {
    return {
      phase: "shadow",
      week,
      pauseAbove: null,
      alertAbove: null,
      summary: `Week ${week}, shadow phase. Runs beside Raghav's manual process and never pauses on rejections. Rule fidelity must be 100% on the backtest before tuning begins.`,
    };
  }
  if (week <= 8) {
    return {
      phase: "tuning",
      week,
      pauseAbove: 0.75,
      alertAbove: 0.5,
      summary: `Week ${week}, tuning phase. Pauses if rejections exceed 75% of rule-covered recommendations in 2 consecutive reviews. Above 50%, Deepa is alerted but nothing pauses.`,
    };
  }
  return {
    phase: "steady",
    week,
    pauseAbove: 0.25,
    alertAbove: null,
    summary: `Week ${week}, steady phase. Pauses if rejections exceed 25% of rule-covered recommendations in 2 consecutive reviews.`,
  };
}

/**
 * Rejections over rule-covered recommendations in one review.
 * Exceptions are excluded: they carry no recommendation, so there is nothing
 * to reject. A change counts as a rejection, because the number the app
 * produced was not the number that was used.
 */
export function rejectionRate(counts: {
  accepted: number;
  changed: number;
  rejected: number;
}): number | null {
  const total = counts.accepted + counts.changed + counts.rejected;
  if (total === 0) return null;
  return (counts.changed + counts.rejected) / total;
}
