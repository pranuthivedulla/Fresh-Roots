"use client";

import { useActionState } from "react";

import { startRun, type RunOutcome } from "./run/actions.ts";

const EMPTY: RunOutcome = { ok: false, blocks: [], summary: null };

export type OnOrderRow = {
  skuId: string;
  skuName: string;
  unitOfMeasure: string;
  /** From the last list the app exported for this SKU, or null if never. */
  prefill: number | null;
};

export function OnOrderForm({ rows }: { rows: OnOrderRow[] }) {
  const [state, action, pending] = useActionState(startRun, EMPTY);
  const prefilledCount = rows.filter((r) => r.prefill !== null).length;

  return (
    <form action={action} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">On-order stock</h3>
        <p className="text-sm text-slate-600">
          Stock already ordered but not yet received. There is no purchase-order feed, so this is
          typed. Enter <strong>0</strong> where nothing is open — a blank blocks the run and is
          never read as zero.{" "}
          {prefilledCount > 0
            ? `${prefilledCount} of ${rows.length} are pre-filled from the last list sent to Zoho; confirm or edit them.`
            : "Nothing has been exported yet, so there is nothing to pre-fill."}
        </p>
      </div>

      {state.blocks.length > 0 && (
        <div role="alert" className="glass glass-red p-3 text-sm text-red-900">
          <strong className="font-semibold">The run is blocked.</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {state.blocks.map((b, i) => (
              <li key={i}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      <table className="glass-table w-full text-left text-sm">
        <thead className="text-slate-600">
          <tr>
            <th className="py-2 pr-4 font-medium">SKU</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">On order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skuId} className="border-t border-[rgba(23,42,69,0.08)]">
              <td className="py-1.5 pr-4 font-mono text-xs">{r.skuId}</td>
              <td className="py-1.5 pr-4">{r.skuName}</td>
              <td className="py-1.5 pr-4">
                <input
                  name={`on_order_${r.skuId}`}
                  defaultValue={r.prefill ?? ""}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`On-order units for ${r.skuId}`}
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                {r.prefill !== null && (
                  <>
                    <input type="hidden" name={`prefilled_${r.skuId}`} value="1" />
                    <span className="ml-2 text-xs text-slate-500">pre-filled</span>
                  </>
                )}
                <span className="ml-2 text-xs text-slate-500">{r.unitOfMeasure.toLowerCase()}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Applying the rules…" : "Apply the rules"}
      </button>
      <p className="text-xs text-slate-500">
        This produces a draft list for you to review. It does not order anything.
      </p>
    </form>
  );
}
