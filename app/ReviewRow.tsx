"use client";

import { useActionState, useEffect, useState } from "react";

import { CHANGE_REASONS, REJECT_REASONS, type SavedDecision } from "../lib/decision-reasons.ts";
import { decide, type DecisionResult } from "./review/actions.ts";

const EMPTY: DecisionResult = { ok: false, error: null };

export type ReviewRowProps = {
  recommendationId: number;
  skuId: string;
  recommendedQty: number | null;
  isHold: boolean;
  unitOfMeasure: string;
  decision: SavedDecision | null;
};

export function ReviewControls(props: ReviewRowProps) {
  const [state, action, pending] = useActionState(decide, EMPTY);
  const [mode, setMode] = useState<"none" | "change" | "reject">("none");
  const { decision } = props;

  // Collapse back to the summary once the server has accepted the decision.
  // Without this the form stays open over a saved decision, which reads as
  // though nothing was recorded.
  useEffect(() => {
    if (state.ok) setMode("none");
  }, [state.ok]);

  if (decision && mode === "none") {
    return (
      <div className="text-xs">
        <span
          className={
            decision.action === "reject"
              ? "font-medium text-red-700"
              : decision.action === "change"
                ? "font-medium text-amber-700"
                : "font-medium text-emerald-700"
          }
        >
          {decision.action === "accept"
            ? "accepted"
            : decision.action === "change"
              ? `changed to ${decision.finalQty}`
              : "rejected"}
        </span>
        {decision.reasonCode && <span className="text-neutral-600"> — {decision.reasonCode}</span>}
        <button
          type="button"
          onClick={() => setMode("change")}
          className="ml-2 underline underline-offset-2 text-neutral-600"
        >
          change this
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {state.error && (
        <p role="alert" className="text-xs text-red-700">
          {state.error}
        </p>
      )}

      {mode === "none" && (
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="recommendation_id" value={props.recommendationId} />
            <input type="hidden" name="action" value="accept" />
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 disabled:opacity-50"
            >
              {props.isHold ? "Accept hold" : "Accept"}
            </button>
          </form>
          {!props.isHold && (
            <button
              type="button"
              onClick={() => setMode("change")}
              className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium"
            >
              Change
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("reject")}
            className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium"
          >
            Reject
          </button>
        </div>
      )}

      {mode !== "none" && (
        <form action={action} className="space-y-2 rounded border border-neutral-200 bg-neutral-50 p-2">
          <input type="hidden" name="recommendation_id" value={props.recommendationId} />
          <input type="hidden" name="action" value={mode} />

          {mode === "change" && (
            <label className="block text-xs">
              New quantity ({props.unitOfMeasure.toLowerCase()})
              <input
                name="final_qty"
                defaultValue={props.recommendedQty ?? 0}
                inputMode="numeric"
                required
                className="ml-2 w-24 rounded border border-neutral-300 px-2 py-1 text-xs"
              />
            </label>
          )}

          <label className="block text-xs">
            Reason (required)
            <select
              name="reason_code"
              required
              defaultValue=""
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="" disabled>
                Choose one
              </option>
              {(mode === "change" ? CHANGE_REASONS : REJECT_REASONS).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            Note (optional)
            <input
              name="reason_text"
              className="ml-2 w-64 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : mode === "change" ? "Save change" : "Save rejection"}
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
