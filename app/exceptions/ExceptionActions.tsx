"use client";

import { useActionState } from "react";

import { moveToExceptions, returnToList, type MoveResult } from "./actions.ts";

const EMPTY: MoveResult = { ok: false, error: null };

/** Put a hand-moved SKU back on the draft list, with the verdict it had. */
export function ReturnToList({ recommendationId }: { recommendationId: number }) {
  const [state, action, pending] = useActionState(returnToList, EMPTY);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="recommendation_id" value={recommendationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-white/70 bg-white/70 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
      >
        {pending ? "Putting back…" : "Put back on the list"}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

/** Move a SKU off the draft list into the queue, with a note saying why. */
export function MoveToQueue({ candidates }: { candidates: { id: number; label: string }[] }) {
  const [state, action, pending] = useActionState(moveToExceptions, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">SKU</span>
        <select
          name="recommendation_id"
          required
          defaultValue=""
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Choose a SKU
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Why (required)</span>
        <input
          name="note"
          required
          placeholder="What the rules cannot see"
          className="w-72 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-white/70 bg-white/70 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Moving…" : "Move to the queue"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
