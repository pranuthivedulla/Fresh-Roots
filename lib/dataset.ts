/**
 * Reads the five CSV files into a validated Dataset.
 *
 * Field-level rules enforced here (build prompt, "Ingest checks"):
 *   - required columns present
 *   - ISO week labels parse
 *   - units are non-negative integers
 *   - As_Of_Date comes from the stock file, never from the upload time
 *
 * Load-level gates (staleness, blank on-order, re-upload freshness) live in
 * ingest.ts, because they are about the run, not about a row.
 */

import { parseCsv, type CsvTable } from "./csv.ts";
import {
  compareIsoWeeks,
  formatCalendarDate,
  parseCalendarDate,
  parseIsoWeek,
  type CalendarDate,
} from "./time.ts";
import type {
  CalendarMonth,
  DataProblem,
  Dataset,
  Perishability,
  Sku,
  StockSnapshot,
  Supplier,
  WeeklySale,
} from "./types.ts";

export type SourceFiles = {
  skuMaster: string;
  suppliers: string;
  weeklySales: string;
  stock: string;
  calendar: string;
};

/** The display name of each file, used in every error message. */
export type FileNames = Record<keyof SourceFiles, string>;

export type ReadResult =
  | { ok: true; dataset: Dataset; warnings: DataProblem[] }
  | { ok: false; problems: DataProblem[] };

const REQUIRED_COLUMNS: Record<keyof SourceFiles, string[]> = {
  skuMaster: [
    "SKU_ID",
    "SKU_Name",
    "Category",
    "Perishability",
    "Standard_Reorder_Qty",
    "Unit_of_Measure",
    "Distributor_ID",
  ],
  suppliers: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
  weeklySales: ["SKU_ID", "Week", "Units_Sold"],
  stock: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
  calendar: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
};

export function readDataset(files: SourceFiles, names: FileNames): ReadResult {
  const problems: DataProblem[] = [];
  const tables = {} as Record<keyof SourceFiles, CsvTable>;

  for (const key of Object.keys(REQUIRED_COLUMNS) as (keyof SourceFiles)[]) {
    try {
      const table = parseCsv(files[key]);
      const missing = REQUIRED_COLUMNS[key].filter((c) => !table.header.includes(c));
      if (missing.length > 0) {
        problems.push({
          file: names[key],
          message:
            "missing required column" +
            (missing.length > 1 ? "s" : "") +
            ": " +
            missing.join(", ") +
            ". Found: " +
            table.header.join(", "),
        });
        continue;
      }
      tables[key] = table;
    } catch (err) {
      problems.push({ file: names[key], message: (err as Error).message });
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  // Every SKU id that appears in the master, valid row or not. A SKU rejected
  // for one bad cell must not then make all 16 of its sales rows look like
  // rows for an unknown SKU: one bad cell should report as one problem.
  const idsInMaster = new Set<string>();

  const skus = readSkus(tables.skuMaster, names.skuMaster, problems, idsInMaster);
  const suppliers = readSuppliers(tables.suppliers, names.suppliers, problems);
  const calendar = readCalendar(tables.calendar, names.calendar, problems);
  const stock = readStock(tables.stock, names.stock, problems);
  const sales = readSales(tables.weeklySales, names.weeklySales, problems, idsInMaster);
  if (problems.length > 0) return { ok: false, problems };

  const asOfDate = singleAsOfDate(stock, names.stock, problems);
  if (!asOfDate) return { ok: false, problems };

  // Warnings, not blocks: these do not make the data unusable, but the app must
  // never quietly turn a missing row into a zero.
  const warnings: DataProblem[] = [];
  const supplierIds = new Set(suppliers.map((s) => s.distributorId));
  const skusWithStock = new Set(stock.map((s) => s.skuId));
  for (const sku of skus) {
    if (!supplierIds.has(sku.distributorId)) {
      warnings.push({
        file: names.skuMaster,
        column: "Distributor_ID",
        message: `${sku.skuId} points at distributor ${sku.distributorId}, which is not in ${names.suppliers}`,
      });
    }
    if (!skusWithStock.has(sku.skuId)) {
      warnings.push({
        file: names.stock,
        message: `${sku.skuId} has no stock row, so its stock is unknown, not zero`,
      });
    }
  }

  return { ok: true, dataset: { skus, suppliers, sales, stock, calendar, asOfDate }, warnings };
}

function readSkus(
  table: CsvTable,
  file: string,
  problems: DataProblem[],
  idsInMaster: Set<string>,
): Sku[] {
  const out: Sku[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const skuId = row["SKU_ID"]!.trim();
    if (skuId === "") {
      problems.push({ file, line, column: "SKU_ID", message: "blank SKU_ID" });
      return;
    }
    idsInMaster.add(skuId);
    if (seen.has(skuId)) {
      problems.push({ file, line, column: "SKU_ID", message: `${skuId} appears twice` });
      return;
    }
    seen.add(skuId);

    const perishability = row["Perishability"]!.trim();
    if (perishability !== "Low" && perishability !== "High") {
      problems.push({
        file,
        line,
        column: "Perishability",
        message: `${skuId}: expected Low or High, found "${perishability}". The flag thresholds depend on it, so it cannot be guessed.`,
      });
      return;
    }
    const qty = nonNegativeInteger(row["Standard_Reorder_Qty"]!);
    if (qty === null) {
      problems.push({
        file,
        line,
        column: "Standard_Reorder_Qty",
        message: `${skuId}: "${row["Standard_Reorder_Qty"]}" is not a non-negative whole number`,
      });
      return;
    }
    out.push({
      skuId,
      name: row["SKU_Name"]!.trim(),
      category: row["Category"]!.trim(),
      perishability: perishability as Perishability,
      standardReorderQty: qty,
      unitOfMeasure: row["Unit_of_Measure"]!.trim(),
      distributorId: row["Distributor_ID"]!.trim(),
    });
  });
  return out;
}

function readSuppliers(table: CsvTable, file: string, problems: DataProblem[]): Supplier[] {
  const out: Supplier[] = [];
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const id = row["Distributor_ID"]!.trim();
    if (id === "") {
      problems.push({ file, line, column: "Distributor_ID", message: "blank Distributor_ID" });
      return;
    }
    out.push({
      distributorId: id,
      name: row["Distributor_Name"]!.trim(),
      region: row["Region"]!.trim(),
      status: row["Status"]!.trim(),
    });
  });
  return out;
}

function readCalendar(table: CsvTable, file: string, problems: DataProblem[]): CalendarMonth[] {
  const out: CalendarMonth[] = [];
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const year = nonNegativeInteger(row["Year"]!);
    const month = nonNegativeInteger(row["Month"]!);
    if (year === null || month === null || month < 1 || month > 12) {
      problems.push({
        file,
        line,
        message: `cannot read Year/Month from "${row["Year"]}"/"${row["Month"]}"`,
      });
      return;
    }
    const flag = row["Is_Festival_Month"]!.trim().toUpperCase();
    if (flag !== "TRUE" && flag !== "FALSE") {
      problems.push({
        file,
        line,
        column: "Is_Festival_Month",
        message: `expected TRUE or FALSE, found "${row["Is_Festival_Month"]}"`,
      });
      return;
    }
    out.push({ year, month, isFestivalMonth: flag === "TRUE" });
  });
  return out;
}

function readStock(table: CsvTable, file: string, problems: DataProblem[]): StockSnapshot[] {
  const out: StockSnapshot[] = [];
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const skuId = row["SKU_ID"]!.trim();
    const units = nonNegativeInteger(row["Units_On_Hand"]!);
    if (units === null) {
      problems.push({
        file,
        line,
        column: "Units_On_Hand",
        message: `${skuId || "(blank SKU)"}: "${row["Units_On_Hand"]}" is not a non-negative whole number`,
      });
      return;
    }
    let asOfDate: CalendarDate;
    try {
      asOfDate = parseCalendarDate(row["As_Of_Date"]!);
    } catch (err) {
      problems.push({
        file,
        line,
        column: "As_Of_Date",
        message: `${skuId || "(blank SKU)"}: ${(err as Error).message}`,
      });
      return;
    }
    out.push({ skuId, location: row["Location"]!.trim(), unitsOnHand: units, asOfDate });
  });
  return out;
}

function readSales(
  table: CsvTable,
  file: string,
  problems: DataProblem[],
  knownSkus: Set<string>,
): WeeklySale[] {
  const byKey = new Map<string, WeeklySale>();
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const skuId = row["SKU_ID"]!.trim();
    if (!knownSkus.has(skuId)) {
      problems.push({ file, line, column: "SKU_ID", message: `"${skuId}" is not in the SKU master` });
      return;
    }
    const weekLabel = row["Week"]!.trim();
    try {
      parseIsoWeek(weekLabel);
    } catch (err) {
      problems.push({ file, line, column: "Week", message: `${skuId}: ${(err as Error).message}` });
      return;
    }
    const units = nonNegativeInteger(row["Units_Sold"]!);
    if (units === null) {
      problems.push({
        file,
        line,
        column: "Units_Sold",
        message: `${skuId} ${weekLabel}: "${row["Units_Sold"]}" is not a non-negative whole number`,
      });
      return;
    }
    // Keyed by (SKU, week): a later row replaces an earlier one for the same key.
    byKey.set(`${skuId}|${weekLabel}`, { skuId, weekLabel, units });
  });
  return [...byKey.values()].sort(
    (a, b) => a.skuId.localeCompare(b.skuId) || compareIsoWeeks(a.weekLabel, b.weekLabel),
  );
}

function singleAsOfDate(
  stock: StockSnapshot[],
  file: string,
  problems: DataProblem[],
): CalendarDate | null {
  if (stock.length === 0) {
    problems.push({ file, message: "no stock rows, so the run has no as-of date" });
    return null;
  }
  const distinct = [...new Set(stock.map((s) => formatCalendarDate(s.asOfDate)))];
  if (distinct.length > 1) {
    problems.push({
      file,
      column: "As_Of_Date",
      message: `the file carries ${distinct.length} different as-of dates (${distinct
        .sort()
        .join(", ")}). One snapshot must have one date, or forecast age at order means nothing.`,
    });
    return null;
  }
  return stock[0]!.asOfDate;
}

/** `null` for anything that is not a whole number at or above zero. Blank included. */
export function nonNegativeInteger(text: string): number | null {
  const t = text.trim();
  if (t === "" || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
