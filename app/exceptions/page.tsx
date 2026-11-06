import { redirect } from "next/navigation";

import { currentSession } from "../../lib/auth.ts";
import { listLoads } from "../../lib/repo.ts";
import { round } from "../../lib/rules.ts";
import { latestRunForLoad, recommendationsFor, type SavedRecommendation } from "../../lib/runs.ts";
import { formatCalendarDate } from "../../lib/time.ts";
import { MoveToQueue, ReturnToList } from "./ExceptionActions.tsx";

export const dynamic = "force-dynamic";

/**
 * The exception queue: SKUs the app will not put a number against, each with
 * the reason it was queued and the evidence behind that reason.
 *
 * Nothing here carries a recommendation. The app does not infer an unknown,
 * so an unknown stays unknown and a person decides.
 */
export default async function ExceptionsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");

  const loads = await listLoads(50).catch(() => []);
  const load = loads.find((l) => l.status === "accepted") ?? null;
  const run = load ? await latestRunForLoad(load.id).catch(() => null) : null;
  const all = run ? await recommendationsFor(run.id).catch(() => []) : [];
  const queued = all.filter((r) => r.isException);
  const onList = all.filter((r) => !r.isException);

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">Exception queue</h2>
        <p className="text-sm text-slate-600">
          SKUs the rules will not put a number against. Each one says why. The app never guesses a
          missing value, so these wait for you rather than getting an invented forecast.
        </p>
      </section>

      {!run ? (
        <p className="glass p-3 text-sm">
          No run yet. Load a drop and apply the rules on the Run screen first.
        </p>
      ) : queued.length === 0 ? (
        <p className="glass p-3 text-sm">
          Nothing is queued for the {formatCalendarDate(load!.asOfDate)} run. Every SKU had at least
          12 weeks of history, no outlier week and a stock figure.
        </p>
      ) : (
        <ul className="space-y-3">
          {queued.map((r) => (
            <li key={r.id} className="glass glass-amber p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs">{r.skuId}</span>
                <strong className="font-semibold">{r.skuName}</strong>
                {r.perishability === "High" && (
                  <span className="rounded bg-white px-1.5 py-0.5 text-xs">perishable</span>
                )}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
                {r.exceptionReasons.map((reason, i) => (
                  <li key={i}>{explain(reason, r)}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-700">
                stock{" "}
                {r.unitsOnHand === null ? "unknown" : `${r.unitsOnHand} ${r.unitOfMeasure.toLowerCase()}`} ·
                on order {r.onOrder} · standard reorder quantity {r.standardReorderQty} · distributor{" "}
                {r.distributorId}
              </p>
              <div className="mt-2">
                {r.exceptionReasons.every((x) => x.kind === "manual") && (
                  <ReturnToList recommendationId={r.id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {run && onList.length > 0 && (
        <section className="border-t border-[rgba(23,42,69,0.12)] pt-4">
          <h3 className="mb-1 text-sm font-semibold">Move one here yourself</h3>
          <p className="mb-3 text-sm text-slate-600">
            If a recommendation looks wrong for a reason the rules cannot see, move the SKU here
            instead of accepting a number you do not believe. It leaves the draft list and the
            export, and your note stays with it.
          </p>
          <MoveToQueue candidates={onList.map(toCandidate)} />
        </section>
      )}
    </main>
  );
}

function toCandidate(r: SavedRecommendation) {
  return {
    id: r.id,
    label: `${r.skuId} — ${r.skuName}${r.flag && r.flag !== "in-range" ? ` (${r.flag})` : ""}`,
  };
}

/** Each reason in words, with the evidence that produced it. */
function explain(reason: SavedRecommendation["exceptionReasons"][number], r: SavedRecommendation): string {
  switch (reason.kind) {
    case "short-history":
      return `Only ${reason.weeksFound} weeks of sales history, and the cover window needs ${reason.weeksRequired}. A new launch has no pattern to average yet.`;
    case "outlier-week":
      return `${reason.weekLabel} sold ${reason.units}, which is ${round(reason.multiple, 1)}x this SKU's median of ${round(reason.median, 1)} for the window. Not cleaned or dropped: decide whether it was real demand or a one-off.`;
    case "unknown-stock":
      return "No row in the stock file, so units on hand are unknown. Unknown is not zero, and cover cannot be computed from it.";
    case "zero-demand":
      return "No sales at all in the cover window, so weeks of cover would be a division by zero.";
    case "manual":
      return `Moved here by ${reason.movedBy}: ${reason.note}`;
    default:
      return "Queued.";
  }
}
