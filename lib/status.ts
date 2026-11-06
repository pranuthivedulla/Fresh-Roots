/**
 * What the app can say about itself without a user doing anything.
 *
 * Used by the banner on every screen, the status page and /api/health. It
 * never throws: a database that is down is a fact to display, not a crash.
 */

import { hostOf, query } from "./db.ts";

export type AppStatus = {
  database:
    | { reachable: true; host: string | null; tables: number; migrations: number }
    | { reachable: false; host: string | null; error: string };
  /** Empty string means unassigned. The banner shows while it is empty. */
  backupChecker: string | null;
  goLiveDate: string | null;
  /** The last time the daily job fired. Null means it never has. */
  lastCronRun: { job: string; ranAt: Date; ok: boolean } | null;
  aiEnabled: boolean;
  emailEnabled: boolean;
  timezone: string;
};

export async function appStatus(): Promise<AppStatus> {
  const base = {
    backupChecker: null as string | null,
    goLiveDate: null as string | null,
    lastCronRun: null as AppStatus["lastCronRun"],
    aiEnabled: (process.env.AI_ENABLED ?? "false").toLowerCase() === "true",
    emailEnabled: (process.env.EMAIL_ENABLED ?? "false").toLowerCase() === "true",
    timezone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
  };
  try {
    const [counts] = await query<{ tables: string; migrations: string }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
              (SELECT count(*) FROM migrations) AS migrations`,
    );
    const settings = await query<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key IN ('backup_checker', 'go_live_date')",
    );
    const byKey = new Map(settings.map((s) => [s.key, s.value]));
    const [cron] = await query<{ job: string; ran_at: Date; ok: boolean }>(
      "SELECT job, ran_at, ok FROM cron_runs ORDER BY ran_at DESC LIMIT 1",
    );
    return {
      ...base,
      lastCronRun: cron ? { job: cron.job, ranAt: cron.ran_at, ok: cron.ok } : null,
      database: {
        reachable: true,
        host: hostOf("pooled"),
        tables: Number(counts?.tables ?? 0),
        migrations: Number(counts?.migrations ?? 0),
      },
      backupChecker: byKey.get("backup_checker") ?? null,
      goLiveDate: byKey.get("go_live_date") || null,
    };
  } catch (err) {
    return {
      ...base,
      database: { reachable: false, host: hostOf("pooled"), error: shortError(err) },
    };
  }
}

/** A message safe to show on a page: no connection strings, no stack. */
export function shortError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  const first = message.split("\n")[0]!.trim();
  if (/DATABASE_URL/.test(first)) return "the database connection string is not set on this deployment";
  if (/ENOTFOUND|EAI_AGAIN/.test(first)) return "the database host could not be resolved";
  if (/ETIMEDOUT|ECONNREFUSED/.test(first)) return "the database did not accept a connection";
  if (/password authentication failed/i.test(first)) return "the database rejected the credentials";
  if (/relation .* does not exist/i.test(first)) return "the schema is not migrated yet";
  return first.slice(0, 200);
}
