/**
 * Generates the test fixtures in tests/fixtures/ from the real sample files.
 *
 *   node --experimental-strip-types tests/make-fixtures.ts
 *
 * Generated, not hand-written, so each fixture differs from the case data in
 * exactly one stated way and stays in step if sample-data/ ever changes.
 *
 * Two kinds:
 *   broken/<case>/<file>  one file, changed in one way, that must block a run.
 *                         The spike composes it over the real sample files, so
 *                         the diff is the whole fixture.
 *   edge-case/            a full five-file drop with three extra SKUs that send
 *                         the exception queue down each of its routes. These
 *                         SKUs are invented test data and are never mixed with
 *                         the case data.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, "..", "sample-data");
const OUT = join(here, "fixtures");

const read = (name: string) => readFileSync(join(SAMPLE, name), "utf8").replace(/\r\n/g, "\n");
const write = (rel: string, body: string) => {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body.endsWith("\n") ? body : body + "\n", "utf8");
  console.log(`  wrote ${rel}`);
};

const skuMaster = read("sku_master.csv");
const sales = read("weekly_sales.csv");
const stock = read("current_inventory.csv");
const suppliers = read("distributor_master.csv");
const calendar = read("calendar.csv");

console.log("broken drops (each must block the run):");

// 1. Stale: the snapshot is 48 days before the sample run date of 19 Oct 2026.
write("broken/stale/current_inventory.csv", stock.replace(/2026-10-19/g, "2026-09-01"));

// 2. Missing column: Units_Sold is gone, so no SKU has a demand figure.
write(
  "broken/missing-column/weekly_sales.csv",
  sales
    .split("\n")
    .map((line, i) => (i === 0 ? "SKU_ID,Week" : line.split(",").slice(0, 2).join(",")))
    .join("\n"),
);

// 3. Bad week labels: a week that cannot exist, and a label in another format.
write(
  "broken/bad-week-label/weekly_sales.csv",
  sales.replace("SKU001,2026-W29,204", "SKU001,2026-W99,204").replace("SKU002,2026-W29,86", "SKU002,Week 29,86"),
);

// 4. As-of date in the future.
write("broken/future-date/current_inventory.csv", stock.replace(/2026-10-19/g, "2027-03-01"));

// 5. One snapshot carrying two different as-of dates.
write(
  "broken/mixed-as-of/current_inventory.csv",
  stock
    .split("\n")
    .map((line, i) => (i >= 8 && line.trim() !== "" ? line.replace("2026-10-19", "2026-10-12") : line))
    .join("\n"),
);

// 6. Negative units sold.
write("broken/negative-units/weekly_sales.csv", sales.replace("SKU003,2026-W33,145", "SKU003,2026-W33,-145"));

// 7. Perishability that is neither Low nor High, which the thresholds depend on.
write("broken/bad-perishability/sku_master.csv", skuMaster.replace(",Dairy Alt,High,", ",Dairy Alt,Medium,"));

// 8. A sales row for a SKU that is not in the master.
write("broken/unknown-sku/weekly_sales.csv", sales.trimEnd() + "\nSKU999,2026-W42,120");

// 9. Fresh snapshot in a month the festival calendar does not cover.
write("broken/calendar-gap/current_inventory.csv", stock.replace(/2026-10-19/g, "2027-01-04"));

console.log("\nedge-case drop (sends the exception queue down each route):");

type NewSku = {
  row: string;
  weeks: [string, number][];
  stock: number | null;
  why: string;
};

const WEEKS = Array.from({ length: 16 }, (_, i) => `2026-W${27 + i}`);
const weeksFrom = (offset: number, units: number[]): [string, number][] =>
  units.map((u, i) => [WEEKS[offset + i]!, u] as [string, number]);

const extras: NewSku[] = [
  {
    // Eight weeks of history: a new launch. Fewer than 12 weeks, so no forecast.
    row: "SKU016,Freshroots Ragi Flour 1kg,Staple,Low,200,Units,DIST002",
    weeks: weeksFrom(8, [40, 44, 47, 52, 55, 58, 61, 64]),
    stock: 300,
    why: "short-history: 8 weeks, under the 12-week window",
  },
  {
    // One week at 4x the window median: an outlier, shown not cleaned.
    row: "SKU017,Freshroots Cold Brew 250ml,Beverage,Low,250,Units,DIST001",
    weeks: weeksFrom(0, [58, 61, 59, 62, 60, 57, 63, 60, 59, 61, 60, 240, 62, 59, 61, 60]),
    stock: 500,
    why: "outlier-week: 2026-W38 at 240 against a window median of 60",
  },
  {
    // In the master and in sales, but absent from the stock file. Unknown, not zero.
    row: "SKU018,Freshroots Jaggery Cubes 400g,Condiment,Low,100,Units,DIST003",
    weeks: weeksFrom(0, [24, 26, 25, 27, 24, 25, 26, 25, 27, 24, 26, 25, 24, 27, 25, 26]),
    stock: null,
    why: "unknown-stock: no row in the stock file",
  },
];

write("edge-case/sku_master.csv", skuMaster.trimEnd() + "\n" + extras.map((e) => e.row).join("\n"));
write(
  "edge-case/weekly_sales.csv",
  sales.trimEnd() +
    "\n" +
    extras
      .flatMap((e) => e.weeks.map(([week, units]) => `${e.row.split(",")[0]},${week},${units}`))
      .join("\n"),
);
write(
  "edge-case/current_inventory.csv",
  stock.trimEnd() +
    "\n" +
    extras
      .filter((e) => e.stock !== null)
      .map((e) => `${e.row.split(",")[0]},Pune Central Warehouse,${e.stock},2026-10-19`)
      .join("\n"),
);
write("edge-case/distributor_master.csv", suppliers);
write("edge-case/calendar.csv", calendar);
write(
  "edge-case/README.md",
  [
    "# Edge-case drop",
    "",
    "Generated by `tests/make-fixtures.ts`. The 15 case SKUs are unchanged. Three",
    "invented SKUs are appended so the exception queue is exercised:",
    "",
    ...extras.map((e) => `- **${e.row.split(",")[0]}** ${e.why}`),
    "",
    "These are test fixtures. They are never loaded as case data and the app",
    "labels this drop as a fixture wherever it is offered.",
  ].join("\n"),
);

console.log("\ndone");
