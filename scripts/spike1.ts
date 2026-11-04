/**
 * Spike 1: the five rules on the sample files. No UI, no database, no network.
 *
 *   node --experimental-strip-types scripts/spike1.ts
 *
 * It loads the five CSVs, runs the rules as of the sample snapshot date
 * (19 Oct 2026, a festival month) with on-order = 0 for every SKU, prints the
 * numbers behind each verdict, and compares the result with the acceptance
 * table in section 10 of the build prompt. Any difference is reported and the
 * exit code is 1.
 */

import { runRules, round, type Evaluation } from "../lib/rules.ts";
import { demoRunDate, loadSampleDataset, sampleOnOrder } from "../lib/sample.ts";
import { formatCalendarDate, isoWeekLabelOf, monthKey } from "../lib/time.ts";
import { SECTION_10, SECTION_10_HIGH_DEMAND, SECTION_10_TOTALS } from "../tests/section10.ts";

const read = loadSampleDataset();
if (!read.ok) {
  console.error("The sample files did not load:");
  for (const p of read.problems) console.error(`  - ${p.file}${p.line ? `:${p.line}` : ""} ${p.message}`);
  process.exit(1);
}
const { dataset, warnings } = read;
const runDate = demoRunDate(dataset);

console.log("Spike 1: the five rules on the sample files");
console.log("=".repeat(104));
console.log(`SKUs ${dataset.skus.length}   sales rows ${dataset.sales.length}   suppliers ${dataset.suppliers.length}`);
console.log(`Stock as of  ${formatCalendarDate(dataset.asOfDate)} (${isoWeekLabelOf(dataset.asOfDate)}), read from the stock file`);
console.log(`Run date     ${formatCalendarDate(runDate)}  month ${monthKey(runDate)}  (demo drop runs as of its own snapshot)`);
const weeks = [...new Set(dataset.sales.map((s) => s.weekLabel))].sort();
console.log(`Sales weeks  ${weeks[0]} to ${weeks[weeks.length - 1]} (${weeks.length} weeks)`);
console.log(`On order     0 for every SKU, entered explicitly`);
if (warnings.length > 0) {
  console.log("\nWarnings (not blocks):");
  for (const w of warnings) console.log(`  - ${w.file} ${w.message}`);
}

const result = runRules({ dataset, onOrder: sampleOnOrder(dataset), runDate });
console.log(`Festival month per calendar.csv: ${result.festivalMonth ? "YES, demand x1.25 except on high-demand SKUs" : "no"}`);

console.log("\n" + "-".repeat(104));
console.log(
  pad("SKU", 8) + pad("per.", 6) + r("avg12", 8) + r("avg4", 8) + r("+%", 7) + pad("  HD", 5) +
    r("uplift", 7) + r("demand", 8) + r("stock", 7) + r("cover", 7) + pad("  flag", 12) + r("qty", 7),
);
console.log("-".repeat(104));
for (const e of result.evaluations) {
  const n = e.numbers;
  const pct = n.avg12 && n.avg4 ? ((n.avg4 - n.avg12) / n.avg12) * 100 : null;
  console.log(
    pad(e.skuId, 8) +
      pad(e.sku.perishability === "High" ? "high" : "low", 6) +
      r(n.avg12 === null ? "-" : round(n.avg12, 2).toFixed(2), 8) +
      r(n.avg4 === null ? "-" : round(n.avg4, 2).toFixed(2), 8) +
      r(pct === null ? "-" : round(pct, 1).toFixed(1), 7) +
      pad(n.isHighDemand ? "  YES" : "   -", 5) +
      r(n.upliftApplied === 1 ? "-" : `x${n.upliftApplied}`, 7) +
      r(n.demandUsed === null ? "-" : round(n.demandUsed, 2).toFixed(2), 8) +
      r(n.unitsOnHand === null ? "unknown" : String(n.unitsOnHand), 7) +
      r(n.cover === null ? "-" : round(n.cover, 1).toFixed(1), 7) +
      pad("  " + (e.isException ? "EXCEPTION" : e.flag), 12) +
      r(e.isException ? "-" : e.recommendation === "hold" ? "hold" : e.recommendedQty === 0 ? "none" : String(e.recommendedQty), 7),
  );
}
console.log("-".repeat(104));
console.log(
  `Totals: ${result.counts.stockout} stockout, ${result.counts.overstock} overstock, ` +
    `${result.counts.inRange} in range, ${result.counts.exceptions} exceptions`,
);

// ---------------------------------------------------------------- comparison

const differences: string[] = [];
for (const expected of SECTION_10) {
  const got = result.evaluations.find((e) => e.skuId === expected.skuId);
  if (!got) {
    differences.push(`${expected.skuId}: not evaluated at all`);
    continue;
  }
  if (got.isException) {
    differences.push(`${expected.skuId}: routed to the exception queue, but section 10 expects a ${expected.flag} verdict`);
    continue;
  }
  const cover = got.numbers.cover === null ? null : round(got.numbers.cover, 1);
  if (cover !== expected.cover) differences.push(`${expected.skuId}: cover ${cover} but section 10 says ${expected.cover}`);
  if (got.flag !== expected.flag) differences.push(`${expected.skuId}: flag ${got.flag} but section 10 says ${expected.flag}`);
  const recommended = got.recommendation === "hold" ? "hold" : got.recommendation === "none" ? "none" : got.recommendedQty;
  if (recommended !== expected.recommended) {
    differences.push(`${expected.skuId}: recommended ${recommended} but section 10 says ${expected.recommended}`);
  }
}
for (const [key, want] of Object.entries(SECTION_10_TOTALS) as [keyof typeof SECTION_10_TOTALS, number][]) {
  if (result.counts[key] !== want) differences.push(`totals: ${key} ${result.counts[key]} but section 10 says ${want}`);
}
const highDemand = result.evaluations.filter((e) => e.numbers.isHighDemand).map((e) => e.skuId);
if (highDemand.join(",") !== SECTION_10_HIGH_DEMAND.join(",")) {
  differences.push(`high-demand SKUs ${highDemand.join(", ") || "none"} but section 10 says ${SECTION_10_HIGH_DEMAND.join(", ")}`);
}

console.log("\nAgainst the section 10 acceptance table:");
if (differences.length === 0) {
  console.log(`  MATCH. All ${SECTION_10.length} rows, the three totals and the high-demand list agree exactly.`);
} else {
  console.log(`  ${differences.length} DIFFERENCE(S):`);
  for (const d of differences) console.log(`    - ${d}`);
}

// --------------------------------------------------------------- why drawers

console.log("\nWhy, for the five flagged SKUs and the two holds (this is the drawer content):");
for (const e of result.evaluations) {
  if (e.isException || e.flag === "in-range") continue;
  console.log(`\n  ${e.skuId}  ${e.sku.name}`);
  console.log(`    ${e.sku.perishability === "High" ? "perishable" : "standard"}, standard reorder qty ${e.sku.standardReorderQty} ${e.sku.unitOfMeasure.toLowerCase()}, distributor ${e.sku.distributorId}`);
  console.log(`    window ${e.window[0]!.weekLabel} to ${e.window[e.window.length - 1]!.weekLabel}: ${e.window.map((w) => w.units).join(", ")}`);
  for (const r of e.rulesFired) console.log(`    ${r.rule}: ${r.detail}`);
  console.log(`    verdict: ${e.flag}, ${e.recommendation === "hold" ? "hold (quantity 0)" : e.recommendation === "order" ? `order ${e.recommendedQty}` : "no recommendation"}`);
}

console.log("\nNothing here orders anything. The output is a draft list for Raghav to review.");
process.exit(differences.length === 0 ? 0 : 1);

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function r(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}
