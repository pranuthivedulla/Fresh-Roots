"use client";

import { useEffect, useState } from "react";

import { acceptAllFlagged, beginReview, confirmSent, exportForZoho } from "./review/actions.ts";

export type ExportPanelProps = {
  runId: string;
  flaggedCount: number;
  undecided: number;
  readyRows: number;
  exportedAt: string | null;
  sentConfirmedAt: string | null;
};

export function ExportPanel(props: ExportPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Start the clock the first time the review screen is shown for this run.
  // Minutes per run is one of the measures, and it needs a start.
  useEffect(() => {
    void beginReview(props.runId);
  }, [props.runId]);

  const onAcceptAll = async () => {
    const ok = window.confirm(
      `Accept all ${props.undecided} flagged recommendations that you have not decided yet?\n\n` +
        `This does not change anything you have already changed or rejected, and it does not order anything.`,
    );
    if (!ok) return;
    setBusy("accept-all");
    try {
      const r = await acceptAllFlagged(props.runId);
      setNote(`Accepted ${r.accepted}.`);
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const r = await exportForZoho(props.runId);
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      setNote(`Exported ${r.rows} row${r.rows === 1 ? "" : "s"}. Nothing has been sent anywhere yet.`);
    } finally {
      setBusy(null);
    }
  };

  const onConfirm = async () => {
    const ok = window.confirm(
      "Confirm that you have sent this file to Zoho yourself?\n\nThis only records the time. The app does not send anything.",
    );
    if (!ok) return;
    setBusy("confirm");
    try {
      const r = await confirmSent(props.runId);
      setNote(r.ok ? "Recorded." : r.error);
    } finally {
      setBusy(null);
    }
  };

  const status = props.sentConfirmedAt
    ? `sent to Zoho (confirmed by Raghav) at ${props.sentConfirmedAt}`
    : props.exportedAt
      ? `exported at ${props.exportedAt}, not yet confirmed as sent`
      : "not exported yet";

  return (
    <section className="space-y-3 rounded border border-neutral-200 bg-white p-3">
      <div>
        <h3 className="text-sm font-semibold">Review and export</h3>
        <p className="text-sm text-neutral-600">
          {props.undecided} of {props.flaggedCount} flagged still undecided. Status:{" "}
          <strong className="font-medium">{status}</strong>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={busy !== null || props.undecided === 0}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {busy === "accept-all" ? "Accepting…" : `Accept all flagged (${props.undecided})`}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={busy !== null || props.readyRows === 0}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "export" ? "Building the file…" : `Export CSV (${props.readyRows} rows)`}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy !== null || !props.exportedAt || props.sentConfirmedAt !== null}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {busy === "confirm" ? "Recording…" : "I have sent this to Zoho"}
        </button>
      </div>

      {note && <p className="text-sm text-neutral-700">{note}</p>}

      <p className="text-xs text-neutral-500">
        The app never writes to Zoho. Exporting builds a file; you send it. Nothing here is an
        order, and nothing is described as ordered.
      </p>
    </section>
  );
}
