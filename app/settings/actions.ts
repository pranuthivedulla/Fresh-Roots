"use server";

import { revalidatePath } from "next/cache";

import { describeRole, requireRole } from "../../lib/auth.ts";
import { setSetting } from "../../lib/repo.ts";
import { DEFAULT_THRESHOLDS, type Thresholds } from "../../lib/settings.ts";
import { saveThresholds } from "../../lib/settings-store.ts";
import { parseCalendarDate } from "../../lib/time.ts";

export type SettingsResult = { ok: boolean; error: string | null; message: string | null };

const OK = (message: string): SettingsResult => ({ ok: true, error: null, message });
const FAIL = (error: string): SettingsResult => ({ ok: false, error, message: null });

/**
 * The backup checker. Only Deepa can set it, every change is logged with who
 * and when, and it never defaults to Raghav. Clearing it is allowed and puts
 * the banner back: pretending someone is named when they are not would be
 * worse than the warning.
 */
export async function setBackupChecker(
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> {
  const session = await requireRole("admin");
  const name = String(formData.get("name") ?? "").trim();

  if (name.toLowerCase() === "raghav") {
    return FAIL(
      "The backup checker cannot be Raghav. He runs the process, so he cannot also be the independent check on it.",
    );
  }
  await setSetting("backup_checker", name, describeRole(session.role));
  revalidatePath("/", "layout");
  return OK(name === "" ? "Cleared. The banner is back on every screen." : `Backup checker is now ${name}.`);
}

/** The go-live date decides the phase, and the phase decides the pause rules. */
export async function setGoLiveDate(
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> {
  const session = await requireRole("admin");
  const raw = String(formData.get("go_live_date") ?? "").trim();

  if (raw === "") {
    await setSetting("go_live_date", "", describeRole(session.role));
    revalidatePath("/", "layout");
    return OK("Cleared. The pilot counts as not started, which reads as shadow phase.");
  }
  try {
    parseCalendarDate(raw);
  } catch {
    return FAIL("Give the date as YYYY-MM-DD.");
  }
  await setSetting("go_live_date", raw, describeRole(session.role));
  revalidatePath("/", "layout");
  return OK(`Go-live date set to ${raw}. The phase follows from it.`);
}

/** The Zoho CSV column order, as a comma-separated list of the five fields. */
export async function setExportColumns(
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> {
  const session = await requireRole("admin");
  const raw = String(formData.get("columns") ?? "").trim();
  const allowed = ["SKU_ID", "SKU_Name", "Distributor_ID", "Quantity", "Unit_of_Measure"];
  const given = raw.split(",").map((c) => c.trim()).filter(Boolean);

  if (given.length === 0) return FAIL("Give at least one column.");
  const unknown = given.filter((c) => !allowed.includes(c));
  if (unknown.length > 0) {
    return FAIL(`Not a column this app can produce: ${unknown.join(", ")}. Available: ${allowed.join(", ")}.`);
  }
  await setSetting("export_columns", given.join(","), describeRole(session.role));
  revalidatePath("/");
  return OK(`Export columns set to ${given.join(", ")}.`);
}

/** Every threshold, as one change, validated before it is stored. */
export async function updateThresholds(
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> {
  const session = await requireRole("admin");

  const num = (name: string, fallback: number): number => {
    const raw = String(formData.get(name) ?? "").trim();
    if (raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };

  const next: Thresholds = {
    standard: {
      stockoutUnder: num("standard_stockout", DEFAULT_THRESHOLDS.standard.stockoutUnder),
      overstockOver: num("standard_overstock", DEFAULT_THRESHOLDS.standard.overstockOver),
    },
    perishable: {
      stockoutUnder: num("perishable_stockout", DEFAULT_THRESHOLDS.perishable.stockoutUnder),
      overstockOver: num("perishable_overstock", DEFAULT_THRESHOLDS.perishable.overstockOver),
    },
    highDemandAbovePct: num("high_demand_pct", DEFAULT_THRESHOLDS.highDemandAbovePct),
    highDemandMultiplier: num("high_demand_multiplier", DEFAULT_THRESHOLDS.highDemandMultiplier),
    festivalUpliftPct: num("festival_uplift_pct", DEFAULT_THRESHOLDS.festivalUpliftPct),
    coverWindowWeeks: num("cover_window", DEFAULT_THRESHOLDS.coverWindowWeeks),
    recentWindowWeeks: num("recent_window", DEFAULT_THRESHOLDS.recentWindowWeeks),
    outlierMultipleOfMedian: num("outlier_multiple", DEFAULT_THRESHOLDS.outlierMultipleOfMedian),
    staleWarnDays: num("stale_warn", DEFAULT_THRESHOLDS.staleWarnDays),
    staleBlockDays: num("stale_block", DEFAULT_THRESHOLDS.staleBlockDays),
  };

  if (Object.values(next).some((v) => typeof v === "number" && Number.isNaN(v))) {
    return FAIL("Every threshold must be a number.");
  }

  const problem = await saveThresholds(next, describeRole(session.role));
  if (problem) return FAIL(problem);

  revalidatePath("/");
  return OK(
    "Thresholds saved. They apply to the next run; recommendations already produced keep the numbers they were produced with.",
  );
}

/** Puts every threshold back to the locked rule sheet. */
export async function resetThresholds(): Promise<SettingsResult> {
  const session = await requireRole("admin");
  await saveThresholds(DEFAULT_THRESHOLDS, describeRole(session.role));
  revalidatePath("/");
  return OK("Thresholds are back to the locked rule sheet.");
}
