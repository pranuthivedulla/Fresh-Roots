import { redirect } from "next/navigation";

import { currentSession, NotAuthorised } from "../../lib/auth.ts";
import { laterOutcomes, rejectionsByRuleAndMonth } from "../../lib/measures.ts";
import { allPauses, currentPause, harmEvents } from "../../lib/pause.ts";
import { phaseFor } from "../../lib/phase.ts";
import { getSetting } from "../../lib/repo.ts";
import { loadThresholds } from "../../lib/settings-store.ts";
import { formatCalendarDate, parseCalendarDate, todayIST } from "../../lib/time.ts";
import { HarmEventForm, PauseCheckButton, VerdictForm } from "./RcaForms.tsx";

export const dynamic = "force-dynamic";

export default async function RcaPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <main>
        <h2 className="mb-2 text-base font-semibold">Pause and RCA</h2>
        <p className="glass glass-amber p-3 text-sm text-amber-900">
          {new NotAuthorised("admin").message} Deepa is the independent reviewer, so the verdict on
          a pause is not Raghav&rsquo;s to record.
        </p>
      </main>
    );
  }

  const { thresholds } = await loadThresholds();
  const goLive = await getSetting("go_live_date").catch(() => null);
  const phase = phaseFor(goLive ? parseCalendarDate(goLive) : null, todayIST());

  const [open, history, harms, outcomes, grouped] = await Promise.all([
    currentPause().catch(() => null),
    allPauses().catch(() => []),
    harmEvents().catch(() => []),
    laterOutcomes(thresholds).catch(() => []),
    rejectionsByRuleAndMonth().catch(() => []),
  ]);

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">Pause and RCA</h2>
        <p className="text-sm text-slate-600">{phase.summary}</p>
      </section>

      {open ? (
        <section className="glass glass-red p-3 text-sm text-red-900">
          <h3 className="font-semibold">
            {open.verdict === null ? "Paused: manual process active" : `Stopped: ${open.verdict}`}
          </h3>
          <p className="mt-1">{open.trigger}</p>
          <p className="mt-1 text-xs">
            Started {istStamp(open.startedAt)}. RCA due {istStamp(open.rcaDueAt)} (five working
            days). No decision means it stays paused; there is no timer that resumes it.
          </p>
          {open.verdict === null && <VerdictForm pauseId={open.id} />}
          {open.note && <p className="mt-2 text-xs">Note: {open.note}</p>}
        </section>
      ) : (
        <section className="glass-strong p-3 text-sm">
          <h3 className="font-semibold">Not paused</h3>
          <p className="text-slate-600">
            The app is producing recommendations. {phase.summary}
          </p>
          <div className="mt-2">
            <PauseCheckButton />
          </div>
        </section>
      )}

      <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
        <h3 className="mb-1 text-sm font-semibold">Rejections grouped by rule and month</h3>
        <p className="mb-2 text-sm text-slate-600">
          Which rule produced the recommendations people did not use, and why they said they did
          not use them.
        </p>
        {grouped.length === 0 ? (
          <p className="text-sm text-slate-500">
            No changes or rejections recorded yet, so there is nothing to group.
          </p>
        ) : (
          <table className="glass-table w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 pr-3 font-medium">Rule</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 pr-3 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g, i) => (
                <tr key={i} className="border-t border-[rgba(23,42,69,0.08)]">
                  <td className="py-2 pr-3">{g.month}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{g.rule}</td>
                  <td className="py-2 pr-3">{g.action}</td>
                  <td className="py-2 pr-3">{g.reasonCode ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{g.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
        <h3 className="mb-1 text-sm font-semibold">What happened afterwards</h3>
        <p className="mb-2 text-sm text-slate-600">
          For each recommendation that was changed or rejected, what the stock looked like at the
          next snapshot at least two weeks later. This sits beside the verdict so a restart rests
          on evidence rather than on how the last review felt.
        </p>
        {outcomes.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing has been changed or rejected yet.</p>
        ) : (
          <table className="glass-table w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">What Raghav did</th>
                <th className="py-2 pr-3 font-medium">App said</th>
                <th className="py-2 pr-3 font-medium">He used</th>
                <th className="py-2 pr-3 font-medium">Two weeks later</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={i} className="border-t border-[rgba(23,42,69,0.08)]">
                  <td className="py-2 pr-3 font-mono text-xs">{o.skuId}</td>
                  <td className="py-2 pr-3">
                    {o.action}
                    {o.reasonCode && <span className="text-slate-500"> ({o.reasonCode})</span>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{o.recommendedQty ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{o.action === "reject" ? 0 : (o.finalQty ?? "—")}</td>
                  <td className="py-2 pr-3">
                    {o.outcome === "not yet" ? (
                      <span className="text-slate-500">no snapshot two weeks on yet</span>
                    ) : (
                      <span
                        className={
                          o.outcome === "neither" ? "text-emerald-700" : "font-medium text-red-700"
                        }
                      >
                        {o.outcome}
                        {o.laterCover !== null && ` (${o.laterCover.toFixed(1)} wks`}
                        {o.laterAsOf && `, ${formatCalendarDate(o.laterAsOf)})`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
        <h3 className="mb-1 text-sm font-semibold">Harm events</h3>
        <p className="mb-2 text-sm text-slate-600">
          The app holds no prices, so a loss is recorded by hand. Above &#8377;2,00,000 on one SKU
          it suspends the app immediately, in any phase.
        </p>
        <HarmEventForm />
        {harms.length > 0 && (
          <table className="mt-3 glass-table w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-3 font-medium">When (IST)</th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Value</th>
                <th className="py-2 pr-3 font-medium">Recorded by</th>
                <th className="py-2 pr-3 font-medium">What happened</th>
              </tr>
            </thead>
            <tbody>
              {harms.map((h) => (
                <tr key={h.id} className="border-t border-[rgba(23,42,69,0.08)] align-top">
                  <td className="py-2 pr-3">{istStamp(h.at)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{h.skuId ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">&#8377;{h.valueInr.toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-3">{h.recordedBy}</td>
                  <td className="py-2 pr-3 text-slate-700">{h.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {history.length > 0 && (
        <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
          <h3 className="mb-2 text-sm font-semibold">Every pause</h3>
          <ul className="space-y-2 text-sm">
            {history.map((p) => (
              <li key={p.id} className="glass-strong p-3">
                <div className="font-medium">{p.trigger}</div>
                <div className="text-xs text-slate-600">
                  Started {istStamp(p.startedAt)} · RCA due {istStamp(p.rcaDueAt)} ·{" "}
                  {p.verdict
                    ? `${p.verdict} by ${p.decidedBy} at ${p.decidedAt ? istStamp(p.decidedAt) : "—"}`
                    : "no verdict yet, so it stays paused"}
                </div>
                {p.note && <p className="mt-1 text-xs text-slate-700">{p.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
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
