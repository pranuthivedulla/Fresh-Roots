/**
 * The bundled sample drop: the five CSV files from the case, read from disk.
 *
 * This is the demo stand-in for Raghav's SAP export. There is no folder to
 * watch on a serverless host, so the app offers this button instead.
 *
 * Demo run date. The snapshot in the sample files is dated 19 Oct 2026 and does
 * not move, so measuring its freshness against the real clock would block the
 * demo under the app's own 7-day rule. A sample drop therefore runs as of its
 * own snapshot date, and the UI must label it as demo data. A real upload is
 * always measured against the real IST clock. This is the only place where the
 * two differ, and it never applies to an uploaded file.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readDataset, type FileNames, type ReadResult, type SourceFiles } from "./dataset.ts";
import type { CalendarDate } from "./time.ts";
import type { Dataset } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_DIR = join(here, "..", "sample-data");

export const SAMPLE_FILE_NAMES: FileNames = {
  skuMaster: "sku_master.csv",
  suppliers: "distributor_master.csv",
  weeklySales: "weekly_sales.csv",
  stock: "current_inventory.csv",
  calendar: "calendar.csv",
};

export function readSampleFiles(dir: string = SAMPLE_DIR): SourceFiles {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return {
    skuMaster: read(SAMPLE_FILE_NAMES.skuMaster),
    suppliers: read(SAMPLE_FILE_NAMES.suppliers),
    weeklySales: read(SAMPLE_FILE_NAMES.weeklySales),
    stock: read(SAMPLE_FILE_NAMES.stock),
    calendar: read(SAMPLE_FILE_NAMES.calendar),
  };
}

export function loadSampleDataset(dir: string = SAMPLE_DIR): ReadResult {
  return readDataset(readSampleFiles(dir), SAMPLE_FILE_NAMES);
}

/** A sample drop runs as of its own snapshot date. See the note at the top. */
export function demoRunDate(dataset: Dataset): CalendarDate {
  return dataset.asOfDate;
}

/** On-order is required per SKU. The sample drop declares an explicit 0, never a blank. */
export function sampleOnOrder(dataset: Dataset): Map<string, number> {
  return new Map(dataset.skus.map((s) => [s.skuId, 0]));
}
