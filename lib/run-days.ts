/**
 * Which weekdays Raghav is expected to upload on.
 *
 * Needed before a missed-upload reminder can mean anything. Without run days
 * the app can say the data is old, but not that an upload was due and did
 * not arrive, and "your data is old" every morning is a notification people
 * learn to ignore.
 *
 * ISO weekday numbers: 1 = Monday ... 7 = Sunday. The default is Monday (the
 * full export) and Thursday (the stock-only position check), which is the
 * assumed twice-weekly rhythm from the build prompt.
 */

import type { CalendarDate } from "./time.ts";

export const DEFAULT_RUN_DAYS = [1, 4];

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayName(iso: number): string {
  return NAMES[iso - 1] ?? String(iso);
}

export function parseRunDays(raw: string | null): number[] {
  if (!raw || raw.trim() === "") return DEFAULT_RUN_DAYS;
  const days = raw
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : DEFAULT_RUN_DAYS;
}

/** The ISO weekday of a calendar date. 1 = Monday. */
export function isoWeekday(d: CalendarDate): number {
  const day = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function describeRunDays(days: number[]): string {
  if (days.length === 0) return "no run days set";
  return days.map(dayName).join(" and ");
}
