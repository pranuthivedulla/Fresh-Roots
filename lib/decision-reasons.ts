/**
 * The reason lists and decision shapes, with no database import.
 *
 * This file exists so client components can use the pick-lists without
 * dragging `pg` into the browser bundle. Anything here must stay free of
 * server-only imports: one `import ... from "./db.ts"` and every client
 * component that touches a reason code fails to build with "Can't resolve
 * 'fs'", which is a confusing way to learn about a module boundary.
 */

export type Action = "accept" | "change" | "reject";

/** Why a recommended quantity was changed. Short, groupable, and Deepa's to extend. */
export const CHANGE_REASONS: { code: string; label: string }[] = [
  { code: "supplier-moq", label: "Supplier minimum order quantity" },
  { code: "lead-time", label: "Lead time means a different quantity" },
  { code: "promotion", label: "Promotion or campaign coming" },
  { code: "warehouse-space", label: "Warehouse space" },
  { code: "stock-figure-wrong", label: "The stock figure looks wrong" },
  { code: "seasonal-judgement", label: "Seasonal judgement the rules do not hold" },
  { code: "other", label: "Other (say what in the note)" },
];

export const REJECT_REASONS: { code: string; label: string }[] = [
  { code: "already-ordered", label: "Already ordered outside the app" },
  { code: "discontinued", label: "SKU being discontinued" },
  { code: "data-wrong", label: "The underlying data is wrong" },
  { code: "supplier-unavailable", label: "Supplier cannot supply" },
  { code: "disagree-with-rule", label: "I disagree with what the rule produced" },
  { code: "other", label: "Other (say what in the note)" },
];

export function reasonLabel(action: Action, code: string | null): string {
  if (!code) return "";
  const list = action === "reject" ? REJECT_REASONS : CHANGE_REASONS;
  return list.find((r) => r.code === code)?.label ?? code;
}

export type SavedDecision = {
  recommendationId: number;
  action: Action;
  finalQty: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  decidedAt: Date;
};
