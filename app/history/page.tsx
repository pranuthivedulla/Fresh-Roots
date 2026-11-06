import { redirect } from "next/navigation";

import { currentSession } from "../../lib/auth.ts";
import {
  cyclesPerMonth,
  exceptionShare,
  forecastAgeAtOrder,
  minutesPerRun,
  rejectionRateMeasure,
  reviewAdherence,
  ruleFidelity,
  type Measure,
} from "../../lib/measures.ts";
import { listLoads } from "../../lib/repo.ts";
import { loadThresholds } from "../../lib/settings-store.ts";
import { formatCalendarDate } from "../../lib/time.ts";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await currentSession();
  if (!session) redirect("/login");

  const { thresholds } = await loadThresholds();
  const [age, cycles, minutes, rejection, exceptions, adherence, fidelity, loads] = await Promise.all([
    forecastAgeAtOrder().catch(failed("Forecast age at order")),
    cyclesPerMonth().catch(failed("Forecast cycles per month")),
    minutesPerRun().catch(failed("Minutes per run")),
    rejectionRateMeasure().catch(failed("Rejection rate")),
    exceptionShare().catch(failed("Exception share")),
    reviewAdherence().catch(failed("Review adherence")),
    ruleFidelity(thresholds).catch(() => null),
    listLoads(25).catch(() => []),
  ]);

  const measures: Measure[] = [age, cycles, minutes, rejection, exceptions, adherence];

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">History and measures</h2>
        <p className="text-sm text-neutral-600">
          Everything here is counted from what the app recorded as it happened. A measure with no
          data says so rather than showing a zero that looks like a finding.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">The measures</h3>
        <dl className="divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          {measures.map((m) => (
            <div key={m.name} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr]">
              <dt className="font-medium">{m.name}</dt>
              <dd>
                {m.value === null ? (
                  <span className="text-neutral-500">Not yet &mdash; {m.basis}</span>
                ) : (
                  <>
                    <span className="font-medium">{m.value}</span>{" "}
                    <span className="text-neutral-500">({m.basis})</span>
                  </>
                )}
                <p className="mt-0.5 text-xs text-neutral-600">{m.note}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {fidelity && (
        <section
          className={`rounded border p-3 text-sm ${
            fidelity.mismatches.length === 0
              ? "border-neutral-200 bg-white"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <h3 className="text-sm font-semibold">Rule fidelity (backtest)</h3>
          <p>
            {fidelity.value === null ? (
              <span className="text-neutral-500">Not yet &mdash; {fidelity.basis}</span>
            ) : (
              <>
                <strong className="font-semibold">{fidelity.value}</strong> &mdash; {fidelity.basis}
              </>
            )}
          </p>
          <p className="mt-1 text-xs">{fidelity.note}</p>
          {fidelity.mismatches.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {fidelity.mismatches.slice(0, 15).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="border-t border-neutral-200 pt-4">
        <h3 className="mb-2 text-sm font-semibold">Every load</h3>
        {loads.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing loaded yet.</p>
        ) : (
          <table className="w-full border-y border-neutral-200 text-left text-sm">
            <thead className="text-neutral-600">
              <tr>
                <th className="py-2 pr-3 font-medium">Uploaded (IST)</th>
                <th className="py-2 pr-3 font-medium">Data as of</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="py-2 pr-3">{istStamp(l.uploadedAt)}</td>
                  <td className="py-2 pr-3">
                    {formatCalendarDate(l.asOfDate)}
                    {l.demo && <span className="ml-2 text-xs text-neutral-500">demo</span>}
                  </td>
                  <td className="py-2 pr-3">{l.type === "full" ? "full" : "stock only"}</td>
                  <td className="py-2 pr-3">
                    {l.status === "accepted" ? (
                      <span className="text-emerald-700">accepted</span>
                    ) : (
                      <span className="text-red-700">
                        blocked{l.blockedCodes.length > 0 ? `: ${l.blockedCodes.join(", ")}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function failed(name: string) {
  return (): Measure => ({
    name,
    value: null,
    basis: "could not be read from the database",
    note: "This measure failed to load. The others are unaffected.",
  });
}

function istStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
