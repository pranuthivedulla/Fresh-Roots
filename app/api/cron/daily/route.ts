import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query } from "../../../../lib/db.ts";
import { shortError } from "../../../../lib/status.ts";
import { daysBetween, formatCalendarDate, todayIST } from "../../../../lib/time.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The daily job. Vercel calls it on the schedule in vercel.json and sends
 * `Authorization: Bearer $CRON_SECRET` automatically.
 *
 * Today it does one thing: record that it ran, and how stale the newest
 * accepted load was at that moment. That is the substance of the
 * missed-upload check; the reminder itself (banner, and email when enabled)
 * is wired up when the Run screen exists and run days are a setting.
 *
 * It never runs the rules, never creates a recommendation and never sends
 * anything to anyone. A scheduled job that could act on its own would be a
 * way around the human in the loop.
 */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  return run("missed-upload-check");
}

/** The same job, for running it by hand without waiting a day. */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  return run("missed-upload-check (manual)");
}

async function run(job: string) {
  const today = todayIST();
  try {
    const [newest] = await query<{ id: string; as_of_date: Date }>(
      "SELECT id, as_of_date FROM loads WHERE status = 'accepted' ORDER BY as_of_date DESC LIMIT 1",
    );

    const detail = newest
      ? {
          newestLoad: newest.id,
          asOfDate: formatCalendarDate({
            year: newest.as_of_date.getFullYear(),
            month: newest.as_of_date.getMonth() + 1,
            day: newest.as_of_date.getDate(),
          }),
          daysSinceAsOf: daysBetween(
            {
              year: newest.as_of_date.getFullYear(),
              month: newest.as_of_date.getMonth() + 1,
              day: newest.as_of_date.getDate(),
            },
            today,
          ),
        }
      : { newestLoad: null, note: "no accepted load yet" };

    const [row] = await query<{ id: string; ran_at: Date }>(
      "INSERT INTO cron_runs (job, detail, ok) VALUES ($1, $2::jsonb, true) RETURNING id, ran_at",
      [job, JSON.stringify(detail)],
    );

    // One line in the runtime log as well, for the hour it is retained.
    console.log(
      `[cron] ${job} ran at ${row!.ran_at.toISOString()} (IST date ${formatCalendarDate(today)}) ${JSON.stringify(detail)}`,
    );

    return NextResponse.json(
      { ok: true, job, ranAt: row!.ran_at, istDate: formatCalendarDate(today), detail },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = shortError(err);
    console.error(`[cron] ${job} failed: ${message}`);
    // Record the failure too, if the database is reachable enough to take it.
    await query("INSERT INTO cron_runs (job, detail, ok) VALUES ($1, $2::jsonb, false)", [
      job,
      JSON.stringify({ error: message }),
    ]).catch(() => {});
    return NextResponse.json({ ok: false, job, error: message }, { status: 500 });
  }
}

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret === "") return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
