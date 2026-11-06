import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query } from "../../../../lib/db.ts";
import { emailConfig, missedUploadBody, sendEmail } from "../../../../lib/email.ts";
import { describeRunDays, isoWeekday, parseRunDays } from "../../../../lib/run-days.ts";
import { getSetting } from "../../../../lib/repo.ts";
import { shortError } from "../../../../lib/status.ts";
import { daysBetween, formatCalendarDate, todayIST } from "../../../../lib/time.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The daily job. Vercel calls it on the schedule in vercel.json and sends
 * `Authorization: Bearer $CRON_SECRET` itself.
 *
 * It checks whether today is a run day with no upload, records what it found,
 * and emails Raghav if email is on. The banner on the Run screen is the
 * primary channel; email is the second copy, and the job records that it ran
 * either way so "did it fire" never depends on whether a mail went.
 *
 * It never runs the rules, never creates a recommendation and never sends
 * anything to Zoho. A scheduled job that could act on its own would be a way
 * around the human in the loop.
 */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  return run("missed-upload-check");
}

/** The same job by hand, so it can be proven without waiting a day. */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  return run("missed-upload-check (manual)");
}

async function run(job: string) {
  const today = todayIST();
  try {
    const days = parseRunDays(await getSetting("run_days").catch(() => null));
    const todayIso = isoWeekday(today);
    const isRunDay = days.includes(todayIso);

    const [newest] = await query<{ id: string; as_of_date: Date; uploaded_at: Date }>(
      "SELECT id, as_of_date, uploaded_at FROM loads WHERE status = 'accepted' ORDER BY as_of_date DESC LIMIT 1",
    );

    const asOf = newest
      ? {
          year: newest.as_of_date.getFullYear(),
          month: newest.as_of_date.getMonth() + 1,
          day: newest.as_of_date.getDate(),
        }
      : null;
    const daysSinceAsOf = asOf ? daysBetween(asOf, today) : null;

    // An upload counts for today only if it arrived today, IST.
    const uploadedToday = newest
      ? formatCalendarDate({
          year: newest.uploaded_at.getFullYear(),
          month: newest.uploaded_at.getMonth() + 1,
          day: newest.uploaded_at.getDate(),
        }) === formatCalendarDate(today)
      : false;

    const missed = isRunDay && !uploadedToday;

    let email: { status: string; detail: string } | null = null;
    if (missed) {
      const c = emailConfig();
      email = await sendEmail({
        kind: "missed-upload",
        to: c.raghav,
        subject: `Freshroots: no upload yet on ${formatCalendarDate(today)}`,
        body: missedUploadBody({
          lastAsOf: asOf ? formatCalendarDate(asOf) : null,
          daysOld: daysSinceAsOf,
          dueDay: formatCalendarDate(today),
        }),
        config: c,
      });
    }

    const detail = {
      runDays: describeRunDays(days),
      isRunDay,
      uploadedToday,
      missedUpload: missed,
      newestLoad: newest?.id ?? null,
      asOfDate: asOf ? formatCalendarDate(asOf) : null,
      daysSinceAsOf,
      email: email ? `${email.status}: ${email.detail}` : "not needed",
    };

    const [row] = await query<{ id: string; ran_at: Date }>(
      "INSERT INTO cron_runs (job, detail, ok) VALUES ($1, $2::jsonb, true) RETURNING id, ran_at",
      [job, JSON.stringify(detail)],
    );

    console.log(`[cron] ${job} ${row!.ran_at.toISOString()} ${JSON.stringify(detail)}`);

    return NextResponse.json(
      { ok: true, job, ranAt: row!.ran_at, istDate: formatCalendarDate(today), detail },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = shortError(err);
    console.error(`[cron] ${job} failed: ${message}`);
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
