"use client";

import { useState } from "react";

import { signInForDemo } from "./actions.ts";

/** Two doors, one per role, so an assessor can see both halves of the app. */
export function DemoSignIn() {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (role: "reviewer" | "admin") => {
    setBusy(role);
    try {
      await signInForDemo(role);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => go("admin")}
        disabled={busy !== null}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy === "admin" ? "Signing in…" : "Enter as Deepa (all five screens)"}
      </button>
      <button
        type="button"
        onClick={() => go("reviewer")}
        disabled={busy !== null}
        className="rounded border border-white/70 bg-white/70 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy === "reviewer" ? "Signing in…" : "Enter as Raghav"}
      </button>
    </div>
  );
}
