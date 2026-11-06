"use client";

import { useActionState, useState } from "react";

import { addHarmEvent, runPauseCheck, submitVerdict, type RcaResult } from "./actions.ts";

const EMPTY: RcaResult = { ok: false, error: null, message: null };

function Feedback({ state }: { state: RcaResult }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="mt-2 text-sm text-emerald-700">{state.message}</p>;
  return null;
}

export function VerdictForm({ pauseId }: { pauseId: number }) {
  const [state, action, pending] = useActionState(submitVerdict, EMPTY);
  return (
    <form action={action} className="mt-3 space-y-2 rounded border border-red-200 bg-white p-3">
      <input type="hidden" name="pause_id" value={pauseId} />
      <p className="text-sm font-medium text-neutral-900">Verdict</p>
      <div className="space-y-1 text-sm text-neutral-800">
        {[
          ["fix-and-restart", "Fix and restart — the problem is understood and addressed; the app resumes"],
          ["redesign", "Redesign — the approach needs rework; the app stays stopped"],
          ["permanent-kill", "Permanent kill — stop for good"],
        ].map(([value, label]) => (
          <label key={value} className="flex items-start gap-2">
            <input type="radio" name="verdict" value={value} required className="mt-1" />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <label className="block text-sm text-neutral-800">
        <span className="mb-1 block">Written note (required): what you found, and why this decision</span>
        <textarea
          name="note"
          required
          rows={3}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record verdict"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function HarmEventForm() {
  const [state, action, pending] = useActionState(addHarmEvent, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-neutral-600">SKU (optional)</span>
        <input name="sku_id" className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-neutral-600">Value (&#8377;)</span>
        <input
          name="value_inr"
          inputMode="decimal"
          required
          className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-neutral-600">What happened (required)</span>
        <input
          name="note"
          required
          className="w-80 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record harm event"}
      </button>
      <div className="w-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function PauseCheckButton() {
  const [state, setState] = useState<RcaResult>(EMPTY);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setState(await runPauseCheck());
          } finally {
            setBusy(false);
          }
        }}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check the pause rules now"}
      </button>
      <Feedback state={state} />
    </div>
  );
}
