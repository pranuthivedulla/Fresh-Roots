"use client";

import { useActionState, useState } from "react";

import type { LoadOutcome } from "./run/actions.ts";
import { loadEdgeCaseDrop, loadSampleDrop, uploadDrop } from "./run/actions.ts";

const EMPTY: LoadOutcome = { ok: false, blocks: [], warnings: [], summary: null };

export function DropForm() {
  const [uploadState, uploadAction, uploading] = useActionState(uploadDrop, EMPTY);
  const [buttonState, setButtonState] = useState<LoadOutcome | null>(null);
  const [busy, setBusy] = useState<null | "sample" | "edge">(null);
  // Which of the two paths ran most recently. Without this, a success message
  // from a button click stays on screen over a later refused upload, which
  // would tell Raghav a blocked file was accepted.
  const [latest, setLatest] = useState<"none" | "button" | "upload">("none");

  const run = async (which: "sample" | "edge") => {
    setBusy(which);
    setButtonState(null);
    setLatest("button");
    try {
      setButtonState(which === "sample" ? await loadSampleDrop() : await loadEdgeCaseDrop());
    } finally {
      setBusy(null);
    }
  };

  const outcome =
    latest === "upload"
      ? uploadState === EMPTY
        ? null
        : uploadState
      : latest === "button"
        ? buttonState
        : null;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-sm font-semibold">Upload the SAP export</h3>
        <p className="mb-2 text-sm text-neutral-600">
          Drop one or more CSV files. The app works out which is which from the column headings, so
          the file names do not matter. A stock file on its own is a stock-position check and reuses
          the sales history already stored.
        </p>
        <form
          action={uploadAction}
          onSubmit={() => {
            setButtonState(null);
            setLatest("upload");
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            type="file"
            name="files"
            multiple
            accept=".csv,text/csv"
            required
            className="text-sm file:mr-3 file:rounded file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
          />
          <button
            type="submit"
            disabled={uploading || busy !== null}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {uploading ? "Checking…" : "Load these files"}
          </button>
        </form>
      </section>

      <section className="border-t border-neutral-200 pt-4">
        <h3 className="mb-1 text-sm font-semibold">Or load bundled data</h3>
        <p className="mb-2 text-sm text-neutral-600">
          There is no folder to watch on a hosted server, so these stand in for an SAP drop. Both run
          as of their own snapshot date, 19 Oct 2026.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => run("sample")}
            disabled={busy !== null || uploading}
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy === "sample" ? "Loading…" : "Load sample SAP drop"}
          </button>
          <button
            type="button"
            onClick={() => run("edge")}
            disabled={busy !== null || uploading}
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy === "edge" ? "Loading…" : "Load edge-case drop (test fixture)"}
          </button>
        </div>
      </section>

      {outcome && <Outcome outcome={outcome} />}
    </div>
  );
}

function Outcome({ outcome }: { outcome: LoadOutcome }) {
  return (
    <section className="space-y-3 border-t border-neutral-200 pt-4">
      {outcome.ok ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <strong className="font-semibold">Load accepted.</strong> {outcome.summary}
        </p>
      ) : (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <strong className="font-semibold">
            The run is blocked. Nothing was changed, adjusted or guessed.
          </strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {outcome.blocks.map((b, i) => (
              <li key={i}>
                {b.file && <span className="font-mono text-xs">{b.file}</span>}
                {b.file && b.line ? <span className="font-mono text-xs">:{b.line}</span> : null}
                {b.file ? " — " : ""}
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.warnings.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong className="font-semibold">Worth knowing</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {outcome.warnings.map((w, i) => (
              <li key={i}>
                {w.file && <span className="font-mono text-xs">{w.file} — </span>}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
