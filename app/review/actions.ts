"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "../../lib/auth.ts";
import {
  acceptAllUndecided,
  confirmSentToZoho,
  exportRows,
  latestExport,
  markReviewStarted,
  recordDecision,
  recordExport,
  toCsv,
  type Action,
} from "../../lib/decisions.ts";
import { query } from "../../lib/db.ts";
import { phaseFor } from "../../lib/phase.ts";
import { checkRejectionPause } from "../../lib/pause.ts";
import { getSetting } from "../../lib/repo.ts";
import { parseCalendarDate, todayIST } from "../../lib/time.ts";

export type DecisionResult = { ok: boolean; error: string | null };

/** Called when the review screen is first shown, so minutes-per-run has a start. */
export async function beginReview(runId: string): Promise<void> {
  await requireRole("reviewer");
  await markReviewStarted(runId);
}

export async function decide(
  _previous: DecisionResult,
  formData: FormData,
): Promise<DecisionResult> {
  await requireRole("reviewer");

  const recommendationId = Number(formData.get("recommendation_id"));
  const action = String(formData.get("action") ?? "") as Action;
  if (!Number.isFinite(recommendationId) || !["accept", "change", "reject"].includes(action)) {
    return { ok: false, error: "That decision was not understood." };
  }

  const reasonCode = String(formData.get("reason_code") ?? "").trim() || null;
  const reasonText = String(formData.get("reason_text") ?? "").trim() || null;

  // A change or a reject without a reason is refused here and again by the
  // database. The second check is not redundant: it is the one a future
  // caller cannot forget.
  if (action !== "accept" && !reasonCode) {
    return {
      ok: false,
      error: action === "change" ? "Say why the quantity is different." : "Say why this is rejected.",
    };
  }

  let finalQty: number | null = null;
  if (action === "change") {
    const raw = String(formData.get("final_qty") ?? "").trim();
    if (!/^\d+$/.test(raw)) {
      return { ok: false, error: "The new quantity must be a whole number of units, zero or more." };
    }
    finalQty = Number(raw);
  } else if (action === "accept") {
    const [rec] = await query<{ qty: number | null }>(
      "SELECT qty FROM recommendations WHERE id = $1",
      [recommendationId],
    );
    finalQty = rec?.qty === null || rec?.qty === undefined ? null : Number(rec.qty);
  }

  await recordDecision({ recommendationId, action, finalQty, reasonCode, reasonText });
  revalidatePath("/");
  return { ok: true, error: null };
}

/**
 * Accept every flagged recommendation not yet decided.
 *
 * Allowed, with a confirmation in the UI. It does not remove the per-SKU
 * reason required for a change or a reject: those still have to be made one
 * at a time, before or after this.
 */
export async function acceptAllFlagged(runId: string): Promise<{ accepted: number }> {
  await requireRole("reviewer");
  const accepted = await acceptAllUndecided(runId);
  revalidatePath("/");
  return { accepted };
}

/** Builds the CSV, records the export, and hands the file back to the browser. */
export async function exportForZoho(runId: string): Promise<{ filename: string; csv: string; rows: number }> {
  await requireRole("reviewer");
  const rows = await exportRows(runId);
  await recordExport(runId, rows.length);

  // The review is finished, so this is the moment the rejection rate for it
  // is final. Checked here rather than on a schedule: a pause that arrives a
  // day late has already let another list go out.
  const goLive = await getSetting("go_live_date").catch(() => null);
  const rules = phaseFor(goLive ? parseCalendarDate(goLive) : null, todayIST());
  await checkRejectionPause(rules.phase, rules.pauseAbove, rules.alertAbove).catch(() => null);

  revalidatePath("/", "layout");
  return {
    filename: `freshroots-draft-${runId}.csv`,
    csv: toCsv(rows),
    rows: rows.length,
  };
}

/** "I have sent this to Zoho." Records the time; never claims anything was ordered. */
export async function confirmSent(runId: string): Promise<{ ok: boolean; error: string | null }> {
  await requireRole("reviewer");
  const record = await latestExport(runId);
  if (!record) return { ok: false, error: "There is nothing exported to confirm." };
  await confirmSentToZoho(record.id);
  revalidatePath("/");
  return { ok: true, error: null };
}
