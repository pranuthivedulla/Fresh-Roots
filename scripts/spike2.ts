/**
 * Spike 2: the ingest gates. No UI, no database, no network.
 *
 *   node --experimental-strip-types scripts/spike2.ts
 *
 * Every case below feeds the ingest layer something wrong and checks that it is
 * blocked, by the right gate, with a message that names the file and says what
 * to do. The four cases the build prompt asks for are cases 1 to 4. The rest
 * are the other ways the same gates can be reached.
 *
 * The last case loads the edge-case drop and checks that the exception queue
 * actually fires, since the real sample data produces no exceptions at all.
 */

import { ingest, type IngestInput, type LoadRecord, type Notice, type StoredContext } from "../lib/ingest.ts";
import { runRules } from "../lib/rules.ts";
import { loadSampleDataset, readSampleFiles, SAMPLE_FILE_NAMES } from "../lib/sample.ts";
import { parseCalendarDate, type CalendarDate } from "../lib/time.ts";
import type { SourceFiles } from "../lib/dataset.ts";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "tests", "fixtures");
const SAMPLE_RUN_DATE = parseCalendarDate("2026-10-19");

const sample = readSampleFiles();

/** Compose a drop: the real sample files with one file swapped for a fixture. */
function broken(caseName: string, file: keyof SourceFiles): SourceFiles {
  const name = SAMPLE_FILE_NAMES[file];
  return { ...sample, [file]: readFileSync(join(FIXTURES, "broken", caseName, name), "utf8") };
}

function edgeCaseDrop(): SourceFiles {
  const read = (n: string) => readFileSync(join(FIXTURES, "edge-case", n), "utf8");
  return {
    skuMaster: read(SAMPLE_FILE_NAMES.skuMaster),
    suppliers: read(SAMPLE_FILE_NAMES.suppliers),
    weeklySales: read(SAMPLE_FILE_NAMES.weeklySales),
    stock: read(SAMPLE_FILE_NAMES.stock),
    calendar: read(SAMPLE_FILE_NAMES.calendar),
  };
}

/** SKU ids straight out of a sku_master CSV, so on-order covers whatever the case loads. */
function skuIds(skuMasterCsv: string): string[] {
  return skuMasterCsv
    .split("\n")
    .slice(1)
    .map((l) => l.split(",")[0]!.trim())
    .filter((id) => id !== "");
}
function onOrderAll(files: SourceFiles, value: string): Map<string, string> {
  return new Map(skuIds(files.skuMaster).map((id) => [id, value]));
}

const storedFromSample: StoredContext = (() => {
  const read = loadSampleDataset();
  if (!read.ok) throw new Error("the sample files must load before this spike can run");
  const d = read.dataset;
  return { skus: d.skus, suppliers: d.suppliers, calendar: d.calendar, sales: d.sales };
})();

const acceptedOct19: LoadRecord = {
  id: "load-2026-10-19-full",
  uploadedAt: "2026-10-19T09:00:00.000Z",
  asOfDate: SAMPLE_RUN_DATE,
  type: "full",
  fileNames: Object.values(SAMPLE_FILE_NAMES),
  status: "accepted",
};

type Case = {
  n: number;
  title: string;
  /** What is wrong, in one line. */
  given: string;
  input: IngestInput;
  /** Gate codes that must appear among the blocks. */
  expectBlocks?: string[];
  /** Gate codes that must appear among the warnings. */
  expectWarnings?: string[];
  /** True when the run must be allowed through. */
  expectOk?: boolean;
  /** An extra check on an accepted run. Returns a problem string, or null. */
  alsoCheck?: (r: Extract<ReturnType<typeof ingest>, { ok: true }>) => string | null;
};

const base = (files: SourceFiles, now: CalendarDate = SAMPLE_RUN_DATE): IngestInput => ({
  type: "full",
  files,
  names: SAMPLE_FILE_NAMES,
  now,
  onOrder: onOrderAll(files, "0"),
});

const cases: Case[] = [
  {
    n: 1,
    title: "a stale file",
    given: "the stock snapshot is dated 2026-09-01, 48 days before the run",
    input: base(broken("stale", "stock")),
    expectBlocks: ["DATA_TOO_OLD"],
  },
  {
    n: 2,
    title: "a missing column",
    given: "weekly_sales.csv has no Units_Sold column",
    input: base(broken("missing-column", "weeklySales")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 3,
    title: "a bad week label",
    given: "one row says 2026-W99 and another says 'Week 29'",
    input: base(broken("bad-week-label", "weeklySales")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 4,
    title: "a blank on-order cell",
    given: "SKU004 and SKU009 are left blank; everything else is 0",
    input: (() => {
      const input = base(sample);
      input.onOrder.set("SKU004", "");
      input.onOrder.set("SKU009", "   ");
      return input;
    })(),
    expectBlocks: ["ON_ORDER_BLANK"],
  },
  {
    n: 5,
    title: "an on-order cell that is not a count",
    given: "SKU002 is -40, SKU005 is 12.5, SKU008 is 'none'",
    input: (() => {
      const input = base(sample);
      input.onOrder.set("SKU002", "-40");
      input.onOrder.set("SKU005", "12.5");
      input.onOrder.set("SKU008", "none");
      return input;
    })(),
    expectBlocks: ["ON_ORDER_INVALID"],
  },
  {
    n: 6,
    title: "an as-of date in the future",
    given: "the stock snapshot is dated 2027-03-01",
    input: base(broken("future-date", "stock")),
    expectBlocks: ["AS_OF_IN_FUTURE"],
  },
  {
    n: 7,
    title: "one snapshot, two as-of dates",
    given: "eight rows say 2026-10-19 and seven say 2026-10-12",
    input: base(broken("mixed-as-of", "stock")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 8,
    title: "negative units sold",
    given: "SKU003 2026-W33 is -145",
    input: base(broken("negative-units", "weeklySales")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 9,
    title: "a perishability the thresholds cannot read",
    given: "SKU004 is 'Medium', which is neither Low nor High",
    input: base(broken("bad-perishability", "skuMaster")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 10,
    title: "a sales row for a SKU that does not exist",
    given: "SKU999 appears in weekly_sales.csv but not in the master",
    input: base(broken("unknown-sku", "weeklySales")),
    expectBlocks: ["BAD_DATA"],
  },
  {
    n: 11,
    title: "re-uploading an older export",
    given: "a 2026-10-19 load is already stored; this file is dated 2026-10-12",
    input: {
      ...base({ ...sample, stock: sample.stock.replace(/2026-10-19/g, "2026-10-12") }, parseCalendarDate("2026-10-19")),
      previousLoads: [acceptedOct19],
    },
    expectBlocks: ["OLDER_THAN_STORED"],
  },
  {
    n: 12,
    title: "re-uploading the same export",
    given: "the stored load and this file are both 2026-10-19",
    input: { ...base(sample), previousLoads: [acceptedOct19] },
    expectOk: true,
    expectWarnings: ["SAME_SNAPSHOT", "SAME_SALES_WEEK"],
    alsoCheck: (r) => (r.isStockPositionCheck ? null : "should be marked a stock-position check"),
  },
  {
    n: 13,
    title: "a stock-only upload with nothing stored",
    given: "only the stock file, and no earlier full load",
    input: {
      type: "stock-only",
      files: { stock: sample.stock },
      names: SAMPLE_FILE_NAMES,
      now: SAMPLE_RUN_DATE,
      onOrder: onOrderAll(sample, "0"),
    },
    expectBlocks: ["NO_STORED_CONTEXT"],
  },
  {
    n: 14,
    title: "the second run of the week, stock only",
    given: "a Thursday stock file dated 2026-10-22, sales history reused from store",
    input: {
      type: "stock-only",
      files: { stock: sample.stock.replace(/2026-10-19/g, "2026-10-22") },
      names: SAMPLE_FILE_NAMES,
      now: parseCalendarDate("2026-10-22"),
      onOrder: onOrderAll(sample, "0"),
      stored: storedFromSample,
      previousLoads: [acceptedOct19],
    },
    expectOk: true,
    expectWarnings: ["SAME_SALES_WEEK"],
    alsoCheck: (r) => {
      if (r.dataset.sales.length !== 240) return `expected the 240 stored sales rows, got ${r.dataset.sales.length}`;
      if (!r.isStockPositionCheck) return "should be marked a stock-position check";
      return null;
    },
  },
  {
    n: 15,
    title: "a month the festival calendar does not cover",
    given: "a fresh snapshot dated 2027-01-04; calendar.csv stops at 2026-12",
    input: base(broken("calendar-gap", "stock"), parseCalendarDate("2027-01-05")),
    expectOk: true,
    expectWarnings: ["CALENDAR_GAP"],
  },
  {
    n: 16,
    title: "the real sample drop",
    given: "the five case files, on-order 0 everywhere, run as of 2026-10-19",
    input: base(sample),
    expectOk: true,
    alsoCheck: (r) => (r.dataAgeDays === 0 ? null : `expected a data age of 0 days, got ${r.dataAgeDays}`),
  },
  {
    n: 17,
    title: "the edge-case drop",
    given: "the case files plus SKU016 (8 weeks), SKU017 (a 4x week), SKU018 (no stock row)",
    input: base(edgeCaseDrop()),
    expectOk: true,
    expectWarnings: ["DATA_WARNING"],
    alsoCheck: (r) => {
      const result = runRules({ dataset: r.dataset, onOrder: r.onOrder, runDate: SAMPLE_RUN_DATE });
      const kinds = new Map(
        result.evaluations
          .filter((e) => e.isException)
          .map((e) => [e.skuId, e.exceptionReasons.map((x) => x.kind).join("+")]),
      );
      const want: [string, string][] = [
        ["SKU016", "short-history"],
        ["SKU017", "outlier-week"],
        ["SKU018", "unknown-stock"],
      ];
      const wrong = want.filter(([id, kind]) => kinds.get(id) !== kind);
      if (wrong.length > 0) {
        return `exception reasons wrong: ${wrong.map(([id, kind]) => `${id} expected ${kind}, got ${kinds.get(id) ?? "no exception"}`).join("; ")}`;
      }
      if (result.counts.exceptions !== 3) return `expected 3 exceptions, got ${result.counts.exceptions}`;
      // The 15 case SKUs must be untouched by the three extras.
      if (result.counts.stockout !== 5 || result.counts.overstock !== 2 || result.counts.inRange !== 8) {
        return `the case SKUs moved: ${result.counts.stockout} stockout, ${result.counts.overstock} overstock, ${result.counts.inRange} in range`;
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------- the run

console.log("Spike 2: the ingest gates");
console.log("=".repeat(100));

let failures = 0;
for (const c of cases) {
  const result = ingest(c.input);
  const blocks: Notice[] = result.ok ? [] : result.blocks;
  const warnings = result.warnings;
  const codes = new Set(blocks.map((b) => b.code));
  const warnCodes = new Set(warnings.map((w) => w.code));

  const problems: string[] = [];
  if (c.expectOk && !result.ok) problems.push("blocked, but this run should be allowed through");
  if (!c.expectOk && result.ok) problems.push("allowed through, but this run should be blocked");
  for (const code of c.expectBlocks ?? []) {
    if (!codes.has(code)) problems.push(`expected a ${code} block, got ${[...codes].join(", ") || "none"}`);
  }
  for (const code of c.expectWarnings ?? []) {
    if (!warnCodes.has(code)) problems.push(`expected a ${code} warning, got ${[...warnCodes].join(", ") || "none"}`);
  }
  for (const b of blocks) {
    if (b.message.trim().length < 20) problems.push(`the ${b.code} message is too short to act on: "${b.message}"`);
  }
  if (result.ok && c.alsoCheck) {
    const extra = c.alsoCheck(result);
    if (extra) problems.push(extra);
  }
  if (problems.length > 0) failures++;

  console.log(`\n${problems.length === 0 ? "PASS" : "FAIL"}  ${String(c.n).padStart(2)}. ${c.title}`);
  console.log(`      given: ${c.given}`);
  console.log(`      result: ${result.ok ? "run allowed" : `BLOCKED (${blocks.length} block${blocks.length === 1 ? "" : "s"})`}`);
  for (const b of dedupe(blocks)) console.log(`        [${b.code}] ${where(b)}${b.message}`);
  for (const w of dedupe(warnings)) console.log(`        warn [${w.code}] ${where(w)}${w.message}`);
  for (const p of problems) console.log(`        >>> ${p}`);
}

console.log("\n" + "=".repeat(100));
console.log(`${cases.length - failures} of ${cases.length} cases behaved as specified.`);
if (failures > 0) console.log(`${failures} case(s) did not. See the >>> lines above.`);
console.log("No gate repairs, cleans or guesses a value. A blocked run stays blocked.");
process.exit(failures === 0 ? 0 : 1);

/** Collapse repeats of one gate so a 15-SKU blank does not print 15 times. */
function dedupe(notices: Notice[]): Notice[] {
  const byCode = new Map<string, Notice[]>();
  for (const n of notices) {
    const list = byCode.get(n.code);
    if (list) list.push(n);
    else byCode.set(n.code, [n]);
  }
  const out: Notice[] = [];
  for (const [code, list] of byCode) {
    out.push(list[0]!);
    if (list.length > 1) {
      out.push({ code, message: `and ${list.length - 1} more ${code} ${list.length - 1 === 1 ? "problem" : "problems"} on other rows` });
    }
  }
  return out;
}
function where(n: Notice): string {
  if (!n.file) return n.column ? `${n.column}: ` : "";
  return `${n.file}${n.line ? `:${n.line}` : ""}${n.column ? ` (${n.column})` : ""}: `;
}
