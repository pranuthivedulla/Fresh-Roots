import { NextResponse } from "next/server";
import { appStatus } from "../../../lib/status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public, read-only. Says whether the deployment can reach its database and
 * whether the schema is migrated. It exposes no business data, no counts of
 * anyone's SKUs and no connection string.
 */
export async function GET() {
  const status = await appStatus();
  const ok = status.database.reachable && status.database.migrations > 0;
  return NextResponse.json(
    {
      ok,
      database: status.database.reachable
        ? { reachable: true, tables: status.database.tables, migrations: status.database.migrations }
        : { reachable: false, error: status.database.error },
      backupCheckerAssigned: Boolean(status.backupChecker && status.backupChecker.trim() !== ""),
      aiEnabled: status.aiEnabled,
      emailEnabled: status.emailEnabled,
      timezone: status.timezone,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
