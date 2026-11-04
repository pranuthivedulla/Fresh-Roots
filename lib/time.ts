/**
 * Dates, ISO weeks and months, all in IST (Asia/Kolkata).
 *
 * Everything in this file works on a plain calendar date {year, month, day}.
 * A calendar date has no time zone, so once a Date has been converted to IST
 * parts there is no second chance for a zone to creep in.
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Kolkata";

export type CalendarDate = { year: number; month: number; day: number };

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date an instant falls on, in IST. */
export function toIST(instant: Date): CalendarDate {
  const [y, m, d] = partsFormatter.format(instant).split("-").map(Number);
  return { year: y!, month: m!, day: d! };
}

/** Today in IST. */
export function todayIST(now: Date = new Date()): CalendarDate {
  return toIST(now);
}

/** Parse a plain `YYYY-MM-DD` as a calendar date. Throws on anything else. */
export function parseCalendarDate(text: string): CalendarDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`not a YYYY-MM-DD date: "${text}"`);
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (formatCalendarDate(date) !== text.trim()) {
    throw new Error(`not a real date: "${text}"`);
  }
  return date;
}

export function formatCalendarDate(d: CalendarDate): string {
  const utc = new Date(toUTCms(d));
  return [
    String(utc.getUTCFullYear()).padStart(4, "0"),
    String(utc.getUTCMonth() + 1).padStart(2, "0"),
    String(utc.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Midnight UTC on the same calendar date. Used only for day arithmetic. */
function toUTCms(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUTCms(to) - toUTCms(from)) / 86_400_000);
}

export function addDays(d: CalendarDate, days: number): CalendarDate {
  const utc = new Date(toUTCms(d) + days * 86_400_000);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/** `2026-10` — the month key used by calendar.csv's Year_Month column. */
export function monthKey(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}`;
}

export type IsoWeek = { year: number; week: number };

/** The ISO-8601 week a calendar date falls in. The ISO year is not always the calendar year. */
export function isoWeekOf(d: CalendarDate): IsoWeek {
  const ms = toUTCms(d);
  const mondayIndex = (new Date(ms).getUTCDay() + 6) % 7; // Mon = 0
  // The Thursday of this week decides which ISO year the week belongs to.
  const thursday = ms + (3 - mondayIndex) * 86_400_000;
  const isoYear = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Index = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Index * 86_400_000;
  const week = Math.round((thursday - week1Monday) / (7 * 86_400_000)) + 1;
  return { year: isoYear, week };
}

/** `2026-W27`. */
export function formatIsoWeek(w: IsoWeek): string {
  return `${w.year}-W${String(w.week).padStart(2, "0")}`;
}

export function isoWeekLabelOf(d: CalendarDate): string {
  return formatIsoWeek(isoWeekOf(d));
}

/** Parse `2026-W27`. Throws on anything else, including week 00 and week 54. */
export function parseIsoWeek(label: string): IsoWeek {
  const m = /^(\d{4})-W(\d{2})$/.exec(label.trim());
  if (!m) throw new Error(`not an ISO week label like 2026-W27: "${label}"`);
  const week = Number(m[2]);
  const year = Number(m[1]);
  if (week < 1 || week > weeksInIsoYear(year)) {
    throw new Error(`ISO week out of range for ${year}: "${label}"`);
  }
  return { year, week };
}

export function weeksInIsoYear(year: number): number {
  return isoWeekOf({ year, month: 12, day: 28 }).week; // 28 Dec is always in the last ISO week
}

/** Chronological order for week labels. Sorting the strings is wrong across a year boundary. */
export function compareIsoWeeks(a: string, b: string): number {
  const x = parseIsoWeek(a);
  const y = parseIsoWeek(b);
  return x.year - y.year || x.week - y.week;
}

/** The Monday of an ISO week, as a calendar date. */
export function isoWeekStart(w: IsoWeek): CalendarDate {
  const jan4 = Date.UTC(w.year, 0, 4);
  const jan4Index = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Index * 86_400_000;
  const monday = new Date(week1Monday + (w.week - 1) * 7 * 86_400_000);
  return {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
  };
}
