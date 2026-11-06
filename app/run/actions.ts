"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "../../lib/auth.ts";
import type { SourceFiles } from "../../lib/dataset.ts";
import { query } from "../../lib/db.ts";
import { checkOnOrder, ingest, type IngestInput, type LoadType, type Notice } from "../../lib/ingest.ts";
import { phaseFor } from "../../lib/phase.ts";
import {
  acceptedLoadRecords,
  contentHash,
  getSetting,
  listLoads,
  recordBlockedLoad,
  saveAcceptedLoad,
  storedContext,
} from "../../lib/repo.ts";
import { runRules } from "../../lib/rules.ts";
import { saveRun } from "../../lib/runs.ts";
import { SAMPLE_FILE_NAMES, readSampleFiles, SAMPLE_DIR } from "../../lib/sample.ts";
import { formatCalendarDate, parseCalendarDate, todayIST } from "../../lib/time.ts";

import { join } from "node:path";

export type LoadOutcome = {
  ok: boolean;
  /** What to tell Raghav, in order. */
  blocks: Notice[];
  warnings: Notice[];
  summary: string | null;
};

const EMPTY: LoadOutcome = { ok: false, blocks: [], warnings: [], summary: null };

/**
 * The bundled sample drop. This is the demo stand-in for Raghav's SAP export,
 * because a serverless host cannot watch a folder.
 *
 * A sample drop runs as of its own snapshot date, so the app's own 7-day
 * freshness rule does not block a demo whose data cannot move. A real upload
 * is always measured against the real IST clock.
 */
export async function loadSampleDrop(): Promise<LoadOutcome> {
  await requireRole("reviewer");
  const files = readSampleFiles();
  return acceptDrop({
    files,
    type: "full",
    nowFromSnapshot: true,
    label: "sample",
  });
}

/**
 * The edge-case fixture: the 15 case SKUs plus three invented ones that send
 * the exception queue down each of its routes. Clearly a fixture, never the
 * case data.
 */
export async function loadEdgeCaseDrop(): Promise<LoadOutcome> {
  await requireRole("reviewer");
  const dir = join(SAMPLE_DIR, "..", "tests", "fixtures", "edge-case");
  const files = readSampleFiles(dir);
  return acceptDrop({ files, type: "full", nowFromSnapshot: true, label: "edge-case" });
}

/** A real upload. Files are matched to roles by their header row, not their name. */
export async function uploadDrop(_previous: LoadOutcome, formData: FormData): Promise<LoadOutcome> {
  await requireRole("reviewer");

  const uploaded = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploaded.length === 0) {
    return { ...EMPTY, blocks: [{ code: "NO_FILES", message: "No files were chosen." }] };
  }

  const files: Partial<SourceFiles> = {};
  const unmatched: string[] = [];
  for (const file of uploaded) {
    const text = await file.text();
    const role = detectRole(text);
    if (!role) {
      unmatched.push(file.name);
      continue;
    }
    files[role] = text;
  }
  if (unmatched.length > 0) {
    return {
      ...EMPTY,
      blocks: [
        {
          code: "UNRECOGNISED_FILE",
          message: `Could not tell what ${unmatched.join(", ")} ${unmatched.length === 1 ? "is" : "are"} from the column headings. Expected one of: a SKU master, a distributor list, weekly sales, a stock snapshot, or a festival calendar.`,
        },
      ],
    };
  }

  // Only a stock file means a stock-only load, which reuses stored history.
  const keys = Object.keys(files) as (keyof SourceFiles)[];
  const type: LoadType = keys.length === 1 && keys[0] === "stock" ? "stock-only" : "full";

  return acceptDrop({ files, type, nowFromSnapshot: false, label: "upload" });
}

export type RunOutcome = { ok: boolean; blocks: Notice[]; summary: string | null };

/**
 * Starts a run against the newest accepted load.
 *
 * On-order is read from the form exactly as typed. A blank blocks the whole
 * run and is never read as zero: that is the one place where a missing number
 * would silently change every cover figure on the screen.
 */
export async function startRun(_previous: RunOutcome, formData: FormData): Promise<RunOutcome> {
  const session = await requireRole("reviewer");

  const loads = await listLoads(50);
  const load = loads.find((l) => l.status === "accepted");
  if (!load) {
    return { ok: false, blocks: [{ code: "NO_LOAD", message: "There is no accepted load to run against." }], summary: null };
  }

  const stored = await storedContext();
  if (!stored) {
    return { ok: false, blocks: [{ code: "NO_CONTEXT", message: "Nothing is stored yet." }], summary: null };
  }

  const typed = new Map<string, string>();
  const prefilled = new Set<string>();
  for (const sku of stored.skus) {
    typed.set(sku.skuId, String(formData.get(`on_order_${sku.skuId}`) ?? ""));
    if (formData.get(`prefilled_${sku.skuId}`) === "1") prefilled.add(sku.skuId);
  }

  const checked = checkOnOrder(stored.skus, typed);
  if (checked.blocks.length > 0) {
    return { ok: false, blocks: checked.blocks.slice(0, 12), summary: null };
  }

  const goLive = await getSetting("go_live_date");
  const runDate = load.judgedAsOf ?? todayIST();
  const rules = phaseFor(goLive ? parseCalendarDate(goLive) : null, runDate);

  const result = runRules({
    dataset: {
      skus: stored.skus,
      suppliers: stored.suppliers,
      sales: stored.sales,
      calendar: stored.calendar,
      stock: await stockForLoad(),
      asOfDate: load.asOfDate,
    },
    onOrder: checked.values,
    runDate,
  });

  const runId = `run-${load.id}-${Date.now()}`;
  await saveRun({
    runId,
    loadId: load.id,
    phase: rules.phase,
    onOrder: checked.values,
    prefilled,
    confirmedBy: session.role,
    evaluations: result.evaluations,
  });

  revalidatePath("/");
  const c = result.counts;
  return {
    ok: true,
    blocks: [],
    summary: `${c.stockout} stockout, ${c.overstock} overstock, ${c.inRange} in range, ${c.exceptions} in the exception queue.`,
  };
}

async function stockForLoad() {
  const rows = await query<{ sku_id: string; location: string; units_on_hand: number; as_of_date: Date }>(
    `SELECT DISTINCT ON (sku_id) sku_id, location, units_on_hand, as_of_date
       FROM stock_snapshots ORDER BY sku_id, as_of_date DESC`,
  );
  return rows.map((r) => ({
    skuId: r.sku_id,
    location: r.location,
    unitsOnHand: Number(r.units_on_hand),
    asOfDate: { year: r.as_of_date.getFullYear(), month: r.as_of_date.getMonth() + 1, day: r.as_of_date.getDate() },
  }));
}

// ---------------------------------------------------------------- internals

async function acceptDrop(args: {
  files: Partial<SourceFiles>;
  type: LoadType;
  nowFromSnapshot: boolean;
  label: string;
}): Promise<LoadOutcome> {
  const { files, type } = args;
  const stored = await storedContext();
  const previousLoads = await acceptedLoadRecords();

  // A demo drop is measured against its own snapshot date; a real upload is
  // measured against the real clock. Read the date first, for that decision only.
  const now = args.nowFromSnapshot ? (snapshotDate(files.stock) ?? todayIST()) : todayIST();

  const input: IngestInput = {
    type,
    files,
    names: SAMPLE_FILE_NAMES,
    now,
    stored: stored ?? undefined,
    previousLoads,
  };

  const result = ingest(input);

  if (!result.ok) {
    await recordBlockedLoad({
      id: `${args.label}-${new Date().toISOString()}`,
      asOfDate: snapshotDate(files.stock),
      type,
      fileNames: Object.keys(files).map((k) => SAMPLE_FILE_NAMES[k as keyof SourceFiles]),
      codes: [...new Set(result.blocks.map((b) => b.code))],
    });
    revalidatePath("/");
    return { ok: false, blocks: dedupe(result.blocks), warnings: dedupe(result.warnings), summary: null };
  }

  await saveAcceptedLoad({
    load: { ...result.load, id: `${args.label}-${formatCalendarDate(result.dataset.asOfDate)}-${type}` },
    dataset: result.dataset,
    hash: contentHash([files.skuMaster, files.suppliers, files.weeklySales, files.stock, files.calendar]),
    demo: args.nowFromSnapshot,
    judgedAsOf: now,
  });

  revalidatePath("/");
  return {
    ok: true,
    blocks: [],
    warnings: dedupe(result.warnings),
    summary:
      `${result.dataset.skus.length} SKUs, ${result.dataset.sales.length} weekly sales rows, ` +
      `stock as of ${formatCalendarDate(result.dataset.asOfDate)} ` +
      `(${result.dataAgeDays} day${result.dataAgeDays === 1 ? "" : "s"} old)` +
      (result.isStockPositionCheck ? ". Sales have not moved, so this is a stock-position check." : "."),
  };
}

/** Reads As_Of_Date out of a stock file without validating the rest of it. */
function snapshotDate(stockCsv: string | undefined) {
  if (!stockCsv) return null;
  const lines = stockCsv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  const col = header.indexOf("As_Of_Date");
  if (col < 0 || lines.length < 2) return null;
  try {
    return parseCalendarDate(lines[1]!.split(",")[col]!);
  } catch {
    return null;
  }
}

/** Which of the five files this is, decided by its headings, not its name. */
function detectRole(text: string): keyof SourceFiles | null {
  const header = (text.split(/\r?\n/)[0] ?? "").split(",").map((h) => h.trim());
  const has = (...cols: string[]) => cols.every((c) => header.includes(c));
  if (has("SKU_ID", "Perishability", "Standard_Reorder_Qty")) return "skuMaster";
  if (has("SKU_ID", "Units_On_Hand", "As_Of_Date")) return "stock";
  if (has("SKU_ID", "Week", "Units_Sold")) return "weeklySales";
  if (has("Distributor_ID", "Distributor_Name")) return "suppliers";
  if (has("Year", "Month", "Is_Festival_Month")) return "calendar";
  return null;
}

/** One line per distinct problem, with a count, rather than 15 identical lines. */
function dedupe(notices: Notice[]): Notice[] {
  const byCode = new Map<string, Notice[]>();
  for (const n of notices) {
    const list = byCode.get(n.code);
    if (list) list.push(n);
    else byCode.set(n.code, [n]);
  }
  return [...byCode.values()].map((list) =>
    list.length === 1
      ? list[0]!
      : { ...list[0]!, message: `${list[0]!.message} (and ${list.length - 1} more like it)` },
  );
}
