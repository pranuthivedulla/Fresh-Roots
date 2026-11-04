/**
 * Load-level gates: everything that is about the run rather than about a row.
 *
 * Row-level checks live in dataset.ts (required columns, week labels parse,
 * non-negative integers). This file adds the gates that need to know what the
 * app already holds and what time it is:
 *
 *   - the stock As_Of_Date is read from the file, and blocks when too old
 *   - re-uploading an old file must not look fresh
 *   - a blank on-order cell blocks the run; it is never read as zero
 *   - a stock-only upload reuses the sales history already stored
 *   - the run month must be in the festival calendar, or the run says so
 *
 * A block stops the run. A warning is shown and the run continues. Nothing here
 * repairs, cleans or guesses a value.
 */

import { readDataset, nonNegativeInteger, type FileNames, type SourceFiles } from "./dataset.ts";
import { calendarCovers } from "./rules.ts";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./settings.ts";
import {
  compareIsoWeeks,
  daysBetween,
  formatCalendarDate,
  isoWeekLabelOf,
  monthKey,
  type CalendarDate,
} from "./time.ts";
import type { Dataset, Sku, WeeklySale } from "./types.ts";

export type LoadType = "full" | "stock-only";

/** What the app remembers about a load it has already accepted. */
export type LoadRecord = {
  id: string;
  uploadedAt: string;
  asOfDate: CalendarDate;
  type: LoadType;
  fileNames: string[];
  status: "accepted" | "blocked";
};

export type Notice = {
  /** A stable code, so the UI and the tests can both name the gate. */
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: string;
};

/** The context the app already holds, used by a stock-only upload. */
export type StoredContext = {
  skus: Sku[];
  suppliers: Dataset["suppliers"];
  calendar: Dataset["calendar"];
  sales: WeeklySale[];
};

export type IngestInput = {
  /** A full load carries all five files. A stock-only load carries just the stock file. */
  type: LoadType;
  files: Partial<SourceFiles>;
  names: FileNames;
  /** Today in IST for a real upload, or the snapshot's own date for the sample drop. */
  now: CalendarDate;
  /** Raw on-order values exactly as typed, so a blank stays visibly blank. */
  onOrder: Map<string, string>;
  stored?: StoredContext;
  previousLoads?: LoadRecord[];
  thresholds?: Thresholds;
};

export type IngestResult =
  | {
      ok: true;
      dataset: Dataset;
      onOrder: Map<string, number>;
      load: LoadRecord;
      warnings: Notice[];
      /** True when sales did not move since the last accepted load. */
      isStockPositionCheck: boolean;
      dataAgeDays: number;
    }
  | { ok: false; blocks: Notice[]; warnings: Notice[] };

export function ingest(input: IngestInput): IngestResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const blocks: Notice[] = [];
  const warnings: Notice[] = [];

  // ---- which files must be present -------------------------------------
  const required: (keyof SourceFiles)[] =
    input.type === "full"
      ? ["skuMaster", "suppliers", "weeklySales", "stock", "calendar"]
      : ["stock"];
  for (const key of required) {
    if (input.files[key] === undefined) {
      blocks.push({
        code: "MISSING_FILE",
        file: input.names[key],
        message: `a ${input.type} load needs ${input.names[key]}, and it was not in the drop`,
      });
    }
  }
  if (input.type === "stock-only" && !input.stored) {
    blocks.push({
      code: "NO_STORED_CONTEXT",
      message:
        "a stock-only load reuses the SKU master, supplier list, festival calendar and sales history already stored, and nothing is stored yet. Do a full load first.",
    });
  }
  if (blocks.length > 0) return { ok: false, blocks, warnings };

  // ---- row-level read ---------------------------------------------------
  // A stock-only load is read against the stored context, so the same reader,
  // the same checks, and no second code path.
  const stored = input.stored;
  const files: SourceFiles = {
    skuMaster: input.files.skuMaster ?? toSkuMasterCsv(stored!.skus),
    suppliers: input.files.suppliers ?? toSuppliersCsv(stored!.suppliers),
    weeklySales: input.files.weeklySales ?? toSalesCsv(stored!.sales),
    stock: input.files.stock!,
    calendar: input.files.calendar ?? toCalendarCsv(stored!.calendar),
  };
  const read = readDataset(files, input.names);
  if (!read.ok) {
    return {
      ok: false,
      blocks: read.problems.map((p) => ({
        code: "BAD_DATA",
        message: p.message,
        file: p.file,
        line: p.line,
        column: p.column,
      })),
      warnings,
    };
  }
  const dataset = read.dataset;
  for (const w of read.warnings) {
    warnings.push({ code: "DATA_WARNING", message: w.message, file: w.file, column: w.column });
  }

  // ---- freshness, from the file's own date ------------------------------
  const dataAgeDays = daysBetween(dataset.asOfDate, input.now);
  if (dataAgeDays < 0) {
    blocks.push({
      code: "AS_OF_IN_FUTURE",
      file: input.names.stock,
      column: "As_Of_Date",
      message: `the stock file is dated ${formatCalendarDate(dataset.asOfDate)}, which is ${-dataAgeDays} day(s) after today (${formatCalendarDate(input.now)}). A snapshot cannot be from the future.`,
    });
  } else if (dataAgeDays > t.staleBlockDays) {
    blocks.push({
      code: "DATA_TOO_OLD",
      file: input.names.stock,
      column: "As_Of_Date",
      message: `the stock file is dated ${formatCalendarDate(dataset.asOfDate)}, which is ${dataAgeDays} days old. The limit is ${t.staleBlockDays} days. Export a fresh file from SAP; the run is blocked, not adjusted.`,
    });
  } else if (dataAgeDays > t.staleWarnDays) {
    warnings.push({
      code: "DATA_GETTING_OLD",
      file: input.names.stock,
      column: "As_Of_Date",
      message: `the stock file is ${dataAgeDays} days old (dated ${formatCalendarDate(dataset.asOfDate)}). Over ${t.staleWarnDays} days, so the cover figures lag reality.`,
    });
  }

  // ---- re-uploading an old file must not look fresh --------------------
  const accepted = (input.previousLoads ?? []).filter((l) => l.status === "accepted");
  const newest = accepted.reduce<LoadRecord | null>(
    (best, l) => (best === null || daysBetween(best.asOfDate, l.asOfDate) > 0 ? l : best),
    null,
  );
  if (newest) {
    const delta = daysBetween(newest.asOfDate, dataset.asOfDate);
    if (delta < 0) {
      blocks.push({
        code: "OLDER_THAN_STORED",
        file: input.names.stock,
        column: "As_Of_Date",
        message: `this file is dated ${formatCalendarDate(dataset.asOfDate)}, which is older than the ${formatCalendarDate(newest.asOfDate)} snapshot already loaded (load ${newest.id}). Re-uploading an old export does not make it fresh.`,
      });
    } else if (delta === 0) {
      warnings.push({
        code: "SAME_SNAPSHOT",
        file: input.names.stock,
        column: "As_Of_Date",
        message: `this is the same ${formatCalendarDate(dataset.asOfDate)} snapshot as load ${newest.id}. Stock has not moved since that run.`,
      });
    }
  }

  // ---- on-order: required per SKU, explicit zero, never inferred -------
  const onOrder = new Map<string, number>();
  for (const sku of dataset.skus) {
    const raw = input.onOrder.get(sku.skuId);
    if (raw === undefined || raw.trim() === "") {
      blocks.push({
        code: "ON_ORDER_BLANK",
        column: "on_order",
        message: `on-order is blank for ${sku.skuId} (${sku.name}). Enter 0 if nothing is open. A blank is not read as zero.`,
      });
      continue;
    }
    const value = nonNegativeInteger(raw);
    if (value === null) {
      blocks.push({
        code: "ON_ORDER_INVALID",
        column: "on_order",
        message: `on-order for ${sku.skuId} is "${raw.trim()}", which is not a whole number of units at or above zero.`,
      });
      continue;
    }
    onOrder.set(sku.skuId, value);
  }
  const unknownSkus = [...input.onOrder.keys()].filter(
    (id) => !dataset.skus.some((s) => s.skuId === id),
  );
  if (unknownSkus.length > 0) {
    warnings.push({
      code: "ON_ORDER_UNKNOWN_SKU",
      column: "on_order",
      message: `on-order was entered for ${unknownSkus.join(", ")}, which ${unknownSkus.length === 1 ? "is" : "are"} not in the SKU master. ${unknownSkus.length === 1 ? "It is" : "They are"} ignored.`,
    });
  }

  // ---- sales history must exist ----------------------------------------
  if (dataset.sales.length === 0) {
    blocks.push({
      code: "NO_SALES_HISTORY",
      file: input.names.weeklySales,
      message: "there is no sales history, so no SKU has a demand figure and nothing can be flagged.",
    });
  }

  // ---- festival calendar must cover the run month ----------------------
  if (!calendarCovers(dataset.calendar, input.now)) {
    warnings.push({
      code: "CALENDAR_GAP",
      file: input.names.calendar,
      message: `the festival calendar has no row for ${monthKey(input.now)}, so the run treats it as not a festival month. That is an absent row, not a confirmed FALSE. Add the month before trusting the cover figures.`,
    });
  }

  // ---- weekly sales against twice-weekly runs --------------------------
  const latestWeek = [...new Set(dataset.sales.map((s) => s.weekLabel))].sort(compareIsoWeeks).pop()!;
  const asOfWeek = isoWeekLabelOf(dataset.asOfDate);
  let isStockPositionCheck = input.type === "stock-only";
  if (newest && isoWeekLabelOf(newest.asOfDate) === asOfWeek) {
    isStockPositionCheck = true;
    warnings.push({
      code: "SAME_SALES_WEEK",
      message: `the last accepted load was also in ${asOfWeek}, so the sales history has not changed. Treat this as a stock-position check: only the stock figures are newer.`,
    });
  }
  const salesVsStock = compareIsoWeeks(latestWeek, asOfWeek);
  if (salesVsStock > 0) {
    warnings.push({
      code: "SALES_AHEAD_OF_STOCK",
      file: input.names.weeklySales,
      message: `the sales history runs to ${latestWeek} but the stock snapshot is from ${asOfWeek}, which is earlier. The two files are from different points in time, and weeks of cover divides one by the other.`,
    });
  } else if (salesVsStock === 0) {
    warnings.push({
      code: "INCOMPLETE_WEEK",
      file: input.names.weeklySales,
      message: `the newest sales week is ${latestWeek}, the same week the stock snapshot falls in, so that week is probably part-sold. A part week pulls the averages down and makes cover look longer than it is.`,
    });
  }

  // ---- gaps in each SKU's window --------------------------------------
  const gaps = findWeekGaps(dataset.sales);
  if (gaps.length > 0) {
    warnings.push({
      code: "WEEK_GAPS",
      file: input.names.weeklySales,
      message: `${gaps.length} SKU(s) have missing weeks in their history (${gaps
        .slice(0, 3)
        .map((g) => `${g.skuId}: ${g.missing.slice(0, 3).join(", ")}`)
        .join("; ")}${gaps.length > 3 ? ", ..." : ""}). A missing week is absent, not a zero, so the averages use the weeks that exist.`,
    });
  }

  if (blocks.length > 0) return { ok: false, blocks, warnings };

  const load: LoadRecord = {
    id: `load-${formatCalendarDate(dataset.asOfDate)}-${input.type}`,
    uploadedAt: new Date().toISOString(),
    asOfDate: dataset.asOfDate,
    type: input.type,
    fileNames: required.map((k) => input.names[k]),
    status: "accepted",
  };

  return { ok: true, dataset, onOrder, load, warnings, isStockPositionCheck, dataAgeDays };
}

function findWeekGaps(sales: WeeklySale[]): { skuId: string; missing: string[] }[] {
  const bySku = new Map<string, string[]>();
  for (const s of sales) {
    const list = bySku.get(s.skuId);
    if (list) list.push(s.weekLabel);
    else bySku.set(s.skuId, [s.weekLabel]);
  }
  const out: { skuId: string; missing: string[] }[] = [];
  for (const [skuId, labels] of bySku) {
    const sorted = [...labels].sort(compareIsoWeeks);
    const missing: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      let cursor = nextWeek(sorted[i - 1]!);
      let guard = 0;
      while (cursor !== sorted[i] && guard++ < 120) {
        missing.push(cursor);
        cursor = nextWeek(cursor);
      }
    }
    if (missing.length > 0) out.push({ skuId, missing });
  }
  return out;
}

/** The week label one week after `label`, crossing year ends correctly. */
function nextWeek(label: string): string {
  const [yearPart, weekPart] = label.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  // 28 December is always in the last ISO week of its year.
  const lastWeek = isoWeekLabelOf({ year, month: 12, day: 28 });
  if (label === lastWeek) return `${year + 1}-W01`;
  return `${year}-W${String(week + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Stored context is re-serialised to CSV so that one reader, with one set of
// checks, handles both a full upload and a stock-only upload. It is cheap at
// this size and it removes a whole class of "the stored path skipped a check".

function toSkuMasterCsv(skus: Sku[]): string {
  const head = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID";
  return [head, ...skus.map((s) => [s.skuId, q(s.name), q(s.category), s.perishability, s.standardReorderQty, q(s.unitOfMeasure), s.distributorId].join(","))].join("\n");
}
function toSuppliersCsv(rows: Dataset["suppliers"]): string {
  return ["Distributor_ID,Distributor_Name,Region,Status", ...rows.map((r) => [r.distributorId, q(r.name), q(r.region), q(r.status)].join(","))].join("\n");
}
function toSalesCsv(rows: WeeklySale[]): string {
  return ["SKU_ID,Week,Units_Sold", ...rows.map((r) => [r.skuId, r.weekLabel, r.units].join(","))].join("\n");
}
function toCalendarCsv(rows: Dataset["calendar"]): string {
  return [
    "Year,Month,Year_Month,Is_Festival_Month",
    ...rows.map((r) => [r.year, r.month, `${r.year}-${String(r.month).padStart(2, "0")}`, r.isFestivalMonth ? "TRUE" : "FALSE"].join(",")),
  ].join("\n");
}
function q(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
