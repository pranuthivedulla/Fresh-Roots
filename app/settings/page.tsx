import { redirect } from "next/navigation";

import { currentSession, NotAuthorised } from "../../lib/auth.ts";
import { query } from "../../lib/db.ts";
import { getSetting } from "../../lib/repo.ts";
import { loadThresholds } from "../../lib/settings-store.ts";
import { SettingsForms } from "./SettingsForms.tsx";

export const dynamic = "force-dynamic";

type HistoryRow = { key: string; oldValue: string | null; newValue: string; changedBy: string; changedAt: Date };

export default async function SettingsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    // Not a redirect: saying "this needs Deepa's passcode" is more useful than
    // silently bouncing Raghav somewhere else.
    return (
      <main>
        <h2 className="mb-2 text-base font-semibold">Settings</h2>
        <p className="glass glass-amber p-3 text-sm text-amber-900">
          {new NotAuthorised("admin").message} Thresholds, the backup checker, the go-live date and
          the export columns are Deepa&rsquo;s, so that the person being measured cannot change what
          is being measured.
        </p>
      </main>
    );
  }

  const [{ thresholds, usingDefaults, problem }, backupChecker, goLiveDate, exportColumns] =
    await Promise.all([
      loadThresholds(),
      getSetting("backup_checker").catch(() => null),
      getSetting("go_live_date").catch(() => null),
      getSetting("export_columns").catch(() => null),
    ]);

  const history = (
    await query<{ key: string; old_value: string | null; new_value: string; changed_by: string; changed_at: Date }>(
      "SELECT key, old_value, new_value, changed_by, changed_at FROM settings_history ORDER BY changed_at DESC LIMIT 20",
    ).catch(() => [])
  ).map(
    (r): HistoryRow => ({
      key: r.key,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedBy: r.changed_by,
      changedAt: r.changed_at,
    }),
  );

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">Settings</h2>
        <p className="text-sm text-slate-600">
          Deepa only. Every change is logged with who made it and when, and the log is below.
        </p>
      </section>

      {problem && (
        <p className="glass glass-red p-3 text-sm text-red-900">
          The stored thresholds could not be used ({problem}), so the locked rule sheet is in force.
          Saving below will replace them.
        </p>
      )}

      <SettingsForms
        thresholds={thresholds}
        usingDefaults={usingDefaults}
        backupChecker={backupChecker ?? ""}
        goLiveDate={goLiveDate ?? ""}
        exportColumns={exportColumns ?? "SKU_ID,SKU_Name,Distributor_ID,Quantity,Unit_of_Measure"}
      />

      <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
        <h3 className="mb-2 text-sm font-semibold">Change log</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing has been changed yet.</p>
        ) : (
          <table className="glass-table w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-3 font-medium">When (IST)</th>
                <th className="py-2 pr-3 font-medium">Setting</th>
                <th className="py-2 pr-3 font-medium">From</th>
                <th className="py-2 pr-3 font-medium">To</th>
                <th className="py-2 pr-3 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-t border-[rgba(23,42,69,0.08)] align-top">
                  <td className="py-2 pr-3">{istStamp(h.changedAt)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{h.key}</td>
                  <td className="py-2 pr-3 max-w-xs truncate text-slate-600">
                    {h.oldValue === null ? "—" : h.oldValue === "" ? "(empty)" : h.oldValue}
                  </td>
                  <td className="py-2 pr-3 max-w-xs truncate">
                    {h.newValue === "" ? "(empty)" : h.newValue}
                  </td>
                  <td className="py-2 pr-3">{h.changedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function istStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
