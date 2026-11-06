"use server";

import { revalidatePath } from "next/cache";

import { describeRole, requireRole } from "../../lib/auth.ts";
import { query } from "../../lib/db.ts";
import { phaseFor } from "../../lib/phase.ts";
import { checkRejectionPause, recordHarmEvent, recordVerdict, type Verdict } from "../../lib/pause.ts";
import { getSetting } from "../../lib/repo.ts";
import { parseCalendarDate, todayIST } from "../../lib/time.ts";

export type RcaResult = { ok: boolean; error: string | null; message: string | null };

const OK = (message: string): RcaResult => ({ ok: true, error: null, message });
const FAIL = (error: string): RcaResult => ({ ok: false, error, message: null });

/**
 * Deepa's verdict on a pause. A written note is required here, in the
 * database constraint, and nowhere is it optional: "restart needs Deepa's
 * written note" is the whole guardrail, and an empty note would make the
 * restart unaccountable.
 */
export async function submitVerdict(_previous: RcaResult, formData: FormData): Promise<RcaResult> {
  const session = await requireRole("admin");
  const pauseId = Number(formData.get("pause_id"));
  const verdict = String(formData.get("verdict") ?? "") as Verdict;
  const note = String(formData.get("note") ?? "").trim();

  if (!Number.isFinite(pauseId)) return FAIL("That pause was not recognised.");
  if (!["fix-and-restart", "redesign", "permanent-kill"].includes(verdict)) {
    return FAIL("Choose fix and restart, redesign, or permanent kill.");
  }
  if (note.length < 10) {
    return FAIL("Write a note saying what you found and why this is the decision. At least a sentence.");
  }

  await recordVerdict({ pauseId, verdict, note, decidedBy: describeRole(session.role) });
  revalidatePath("/", "layout");
  return OK(
    verdict === "fix-and-restart"
      ? "Recorded. The app resumes producing recommendations."
      : "Recorded. The app stays stopped.",
  );
}

/**
 * A harm event, recorded by hand because the app holds no prices. Above
 * Rs 2L on one SKU it suspends the app immediately, in any phase.
 */
export async function addHarmEvent(_previous: RcaResult, formData: FormData): Promise<RcaResult> {
  const session = await requireRole("reviewer");
  const skuId = String(formData.get("sku_id") ?? "").trim() || null;
  const raw = String(formData.get("value_inr") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return FAIL("Give the value in rupees, as a number.");
  }
  const valueInr = Number(raw);
  if (valueInr <= 0) return FAIL("A harm event needs a value above zero.");
  if (!note) return FAIL("Say what happened. A rupee figure with no account of it cannot be reviewed.");

  // A SKU that is not in the master would fail on the foreign key, which the
  // person typing would see as the form doing nothing at all. Checked here so
  // the answer is a sentence instead.
  if (skuId) {
    const [known] = await query<{ sku_id: string }>("SELECT sku_id FROM sku_master WHERE sku_id = $1", [skuId]);
    if (!known) {
      return FAIL(
        `${skuId} is not in the SKU master, so the event cannot be attached to it. Check the code, or leave the SKU blank and name it in the note.`,
      );
    }
  }

  let paused = false;
  try {
    ({ paused } = await recordHarmEvent({
      skuId,
      valueInr,
      recordedBy: describeRole(session.role),
      note,
    }));
  } catch (err) {
    return FAIL(`The harm event could not be saved: ${(err as Error).message.split("\n")[0]}`);
  }
  revalidatePath("/", "layout");
  return OK(
    paused
      ? `Recorded, and the app is now paused: Rs ${valueInr.toLocaleString("en-IN")} is above the Rs 2,00,000 limit.`
      : `Recorded. Rs ${valueInr.toLocaleString("en-IN")} is below the Rs 2,00,000 limit, so nothing is paused.`,
  );
}

/**
 * Runs the rejection check now, against the current phase. The same check
 * runs after every export; this is here so the pause rules can be
 * demonstrated without waiting for two real reviews to drift.
 */
export async function runPauseCheck(): Promise<RcaResult> {
  await requireRole("admin");
  const goLive = await getSetting("go_live_date").catch(() => null);
  const rules = phaseFor(goLive ? parseCalendarDate(goLive) : null, todayIST());
  const check = await checkRejectionPause(rules.phase, rules.pauseAbove, rules.alertAbove);
  revalidatePath("/", "layout");
  return OK(`${rules.phase} phase. ${check.reason}`);
}
