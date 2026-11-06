import { appStatus } from "../lib/status.ts";
import { todayIST, formatCalendarDate, isoWeekLabelOf } from "../lib/time.ts";

export const dynamic = "force-dynamic";

/**
 * The deployment status page. It exists so that the first deploy proves
 * something: that the build works, that the environment variables arrived,
 * and that the database is reachable from a Vercel function.
 *
 * It is replaced by the Run screen once the app is built.
 */
export default async function Home() {
  const status = await appStatus();
  const today = todayIST();

  return (
    <main className="space-y-6">
      <section>
        <h2 className="mb-2 text-base font-semibold">Deployment status</h2>
        <p className="mb-4 text-sm text-neutral-600">
          The five screens are not built yet. This page checks that the deployment itself works.
        </p>
        <dl className="divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          <Row label="Database">
            {status.database.reachable ? (
              /* The host is deliberately not shown. This page is public and
                 nobody reading it needs the database's address. */
              <span>
                <Ok /> reachable &middot; {status.database.tables} tables &middot;{" "}
                {status.database.migrations} migration
                {status.database.migrations === 1 ? "" : "s"} applied
              </span>
            ) : (
              <span>
                <Bad /> {status.database.error}
              </span>
            )}
          </Row>
          <Row label="Backup checker">
            {status.backupChecker && status.backupChecker.trim() !== "" ? (
              status.backupChecker
            ) : (
              <span className="text-amber-800">Unassigned</span>
            )}
          </Row>
          <Row label="Go-live date">{status.goLiveDate ?? <Unset>not set, so no phase yet</Unset>}</Row>
          <Row label="Daily job">
            {status.lastCronRun ? (
              <span>
                last fired{" "}
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: status.timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(status.lastCronRun.ranAt)}{" "}
                IST{status.lastCronRun.ok ? "" : " (it failed)"}
              </span>
            ) : (
              <Unset>has not fired yet; scheduled 08:30 IST daily</Unset>
            )}
          </Row>
          <Row label="Today (IST)">
            {formatCalendarDate(today)} &middot; {isoWeekLabelOf(today)}
          </Row>
          <Row label="Time zone">{status.timezone}</Row>
          <Row label="AI">
            {status.aiEnabled ? "on, for exception reasons only" : "off; exception reasons come from plain code"}
          </Row>
          <Row label="Email">{status.emailEnabled ? "on" : "off; the missed-upload reminder is an in-app banner"}</Row>
        </dl>
      </section>

      <section className="rounded border border-neutral-200 bg-white p-4 text-sm">
        <h3 className="mb-1 font-semibold">What this app does not do</h3>
        <p className="text-neutral-700">
          It never writes to Zoho or SAP, never places or approves an order, and never says
          anything was ordered. It produces a draft list; a person reviews it and sends it.
        </p>
      </section>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-4 py-2">
      <dt className="text-neutral-600">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function Ok() {
  return <span className="font-semibold text-emerald-700">OK</span>;
}
function Bad() {
  return <span className="font-semibold text-red-700">FAILED</span>;
}
function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-500">{children}</span>;
}
