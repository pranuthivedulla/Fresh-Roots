import type { SavedRecommendation } from "../lib/runs.ts";
import { round } from "../lib/rules.ts";

/**
 * The draft list: flagged SKUs only, plus a count of everything in range.
 *
 * In-range SKUs are collapsed under a "No action" count rather than listed,
 * so the list is the short one Raghav has to think about. Exceptions are not
 * here at all; they are in the queue, with no recommendation and no guess.
 */
export function DraftList({ recommendations }: { recommendations: SavedRecommendation[] }) {
  const flagged = recommendations.filter((r) => !r.isException && r.flag !== "in-range");
  const inRange = recommendations.filter((r) => !r.isException && r.flag === "in-range");
  const exceptions = recommendations.filter((r) => r.isException);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Draft list</h3>
        <p className="text-sm text-neutral-600">
          {flagged.length} flagged for a decision, {inRange.length} in range with no action,{" "}
          {exceptions.length} in the exception queue. Nothing here has been ordered.
        </p>
      </div>

      {flagged.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-white p-3 text-sm">
          Nothing is flagged. Every SKU with enough history is inside its cover limits.
        </p>
      ) : (
        <table className="w-full border-y border-neutral-200 text-left text-sm">
          <thead className="text-neutral-600">
            <tr>
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Cover</th>
              <th className="py-2 pr-3 font-medium">Flag</th>
              <th className="py-2 pr-3 font-medium">Recommended</th>
              <th className="py-2 pr-3 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((r) => (
              <tr key={r.skuId} className="border-t border-neutral-100 align-top">
                <td className="py-2 pr-3 font-mono text-xs">{r.skuId}</td>
                <td className="py-2 pr-3">
                  {r.skuName}
                  {r.perishability === "High" && (
                    <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
                      perishable
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {r.cover === null ? "—" : `${round(r.cover, 1).toFixed(1)} wks`}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      r.flag === "stockout"
                        ? "font-medium text-red-700"
                        : "font-medium text-amber-700"
                    }
                  >
                    {r.flag}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {r.flag === "overstock" ? (
                    <span>hold</span>
                  ) : (
                    <span className="tabular-nums">
                      {r.qty} {r.unitOfMeasure.toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Why r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inRange.length > 0 && (
        <details className="rounded border border-neutral-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            No action: {inRange.length} SKUs inside their cover limits
          </summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {inRange.map((r) => (
              <li key={r.skuId} className="text-neutral-700">
                <span className="font-mono text-xs">{r.skuId}</span> {r.skuName} —{" "}
                {r.cover === null ? "—" : `${round(r.cover, 1).toFixed(1)} wks`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The arithmetic, on demand. This is what lets the rules be tested, not trusted. */
function Why({ r }: { r: SavedRecommendation }) {
  return (
    <details>
      <summary className="cursor-pointer text-neutral-700 underline underline-offset-2">why</summary>
      <div className="mt-2 max-w-xl space-y-1 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs">
        <p>
          {r.unitsOnHand ?? "unknown"} on hand + {r.onOrder} on order
          {r.avg12 !== null && (
            <>
              {" "}
              ÷ {round(r.avg12 * r.upliftApplied, 2)} per week
              {r.upliftApplied !== 1 && ` (${round(r.avg12, 2)} × ${r.upliftApplied} festival uplift)`}
              {r.cover !== null && ` = ${round(r.cover, 2)} weeks of cover`}
            </>
          )}
        </p>
        <p className="text-neutral-600">
          12-week average {r.avg12 === null ? "—" : round(r.avg12, 2)}, last 4 weeks{" "}
          {r.avg4 === null ? "—" : round(r.avg4, 2)}
          {r.avg12 !== null && r.avg4 !== null && r.avg12 > 0 && (
            <> ({round(((r.avg4 - r.avg12) / r.avg12) * 100, 1)}% difference)</>
          )}
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-neutral-700">
          {r.rulesFired.map((f, i) => (
            <li key={i}>
              <span className="font-mono">{f.rule}</span>: {f.detail}
            </li>
          ))}
        </ul>
        <p className="text-neutral-600">
          Standard reorder quantity {r.standardReorderQty} {r.unitOfMeasure.toLowerCase()},
          distributor {r.distributorId}.
        </p>
      </div>
    </details>
  );
}
