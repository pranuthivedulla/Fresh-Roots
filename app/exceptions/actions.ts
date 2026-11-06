"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "../../lib/auth.ts";
import { query, transaction } from "../../lib/db.ts";

export type MoveResult = { ok: boolean; error: string | null };

/**
 * Raghav moving a SKU into the exception queue by hand.
 *
 * The recommendation loses its flag and quantity, because an exception
 * carries neither and the database enforces that. The verdict it had is kept
 * inside the exception reason, so putting it back restores exactly what the
 * rules produced rather than re-deriving it.
 *
 * Any decision already made on it is removed: a decision about a
 * recommendation that no longer exists would still count in the rejection
 * rate, and the rate is what the pause rules read.
 */
export async function moveToExceptions(
  _previous: MoveResult,
  formData: FormData,
): Promise<MoveResult> {
  const session = await requireRole("reviewer");
  const recommendationId = Number(formData.get("recommendation_id"));
  const note = String(formData.get("note") ?? "").trim();

  if (!Number.isFinite(recommendationId)) return { ok: false, error: "That SKU was not recognised." };
  if (note === "") return { ok: false, error: "Say why this needs a person to look at it." };

  const [current] = await query<{ flag: string | null; qty: number | null; is_exception: boolean }>(
    "SELECT flag, qty, is_exception FROM recommendations WHERE id = $1",
    [recommendationId],
  );
  if (!current) return { ok: false, error: "That SKU was not recognised." };
  if (current.is_exception) return { ok: false, error: "That SKU is already in the queue." };

  const reason = JSON.stringify([
    {
      kind: "manual",
      movedBy: session.role,
      note,
      previousFlag: current.flag,
      previousQty: current.qty === null ? null : Number(current.qty),
    },
  ]);

  await transaction(async (c) => {
    await c.query("DELETE FROM decisions WHERE recommendation_id = $1", [recommendationId]);
    await c.query(
      `UPDATE recommendations
          SET is_exception = true, exception_reason = $2::jsonb, flag = NULL, qty = NULL
        WHERE id = $1`,
      [recommendationId, reason],
    );
  });

  revalidatePath("/");
  revalidatePath("/exceptions");
  return { ok: true, error: null };
}

/**
 * Putting a hand-moved SKU back on the list.
 *
 * It returns to the verdict the rules already produced, taken from the
 * exception reason. The rules are not re-run and no number is recalculated:
 * the data has not changed, so a different answer would mean the app changed
 * its mind on its own.
 *
 * A SKU the rules queued cannot be put back. Too little history, an outlier
 * week or a missing stock figure are facts about the data, not opinions.
 */
export async function returnToList(
  _previous: MoveResult,
  formData: FormData,
): Promise<MoveResult> {
  await requireRole("reviewer");
  const recommendationId = Number(formData.get("recommendation_id"));
  if (!Number.isFinite(recommendationId)) return { ok: false, error: "That SKU was not recognised." };

  const [row] = await query<{
    reason: { kind: string; previousFlag?: string | null; previousQty?: number | null }[] | null;
  }>("SELECT exception_reason AS reason FROM recommendations WHERE id = $1", [recommendationId]);

  const reasons = row?.reason ?? [];
  if (reasons.length === 0 || !reasons.every((r) => r.kind === "manual")) {
    return {
      ok: false,
      error:
        "This one was queued by the rules, not by hand: too little history, an outlier week, or no stock figure. There is no recommendation to go back to.",
    };
  }

  const manual = reasons[0]!;
  if (manual.previousFlag === undefined || manual.previousFlag === null) {
    return {
      ok: false,
      error: "This was moved before the app started recording the verdict it had, so it cannot be put back.",
    };
  }

  await query(
    `UPDATE recommendations
        SET is_exception = false, exception_reason = NULL, flag = $2, qty = $3
      WHERE id = $1`,
    [recommendationId, manual.previousFlag, manual.previousQty ?? 0],
  );

  revalidatePath("/");
  revalidatePath("/exceptions");
  return { ok: true, error: null };
}
