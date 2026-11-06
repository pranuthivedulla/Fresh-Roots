/**
 * Reading and writing the archive.
 *
 * Every accepted load is kept with its file names, its as-of date, its type
 * and a hash of its contents, so a re-uploaded old export is recognisable as
 * both old and identical. Nothing is ever overwritten silently: sales rows are
 * keyed by (SKU, week) and a later load replaces an earlier row for the same
 * key, which is the documented behaviour, and the load that did it is recorded
 * on the row.
 */

import { createHash } from "node:crypto";

import { query, transaction } from "./db.ts";
import type { LoadRecord, LoadType, StoredContext } from "./ingest.ts";
import { formatCalendarDate, type CalendarDate } from "./time.ts";
import type { Dataset } from "./types.ts";

export function contentHash(parts: (string | undefined)[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p ?? "", "utf8");
  return h.digest("hex").slice(0, 32);
}

function toCalendarDate(d: Date): CalendarDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * Turns rows into one array per column, which is what UNNEST takes.
 * [{a:1,b:2},{a:3,b:4}] with (r) => [r.a, r.b] becomes [[1,3],[2,4]].
 */
function columns<T>(rows: T[], pick: (row: T) => unknown[]): unknown[][] {
  const picked = rows.map(pick);
  const width = picked[0]?.length ?? 0;
  return Array.from({ length: width }, (_, i) => picked.map((r) => r[i]));
}

/** Writes the load and everything in it, in one transaction. */
export async function saveAcceptedLoad(args: {
  load: LoadRecord;
  dataset: Dataset;
  hash: string;
  /** True for a bundled drop, which is judged against its own snapshot date. */
  demo: boolean;
  /** The date the freshness rule was measured against when this was accepted. */
  judgedAsOf: CalendarDate;
}): Promise<void> {
  const { load, dataset } = args;
  await transaction(async (c) => {
    await c.query(
      `INSERT INTO loads (id, uploaded_at, as_of_date, type, file_names, status, content_hash, demo, judged_as_of)
       VALUES ($1, now(), $2, $3, $4, 'accepted', $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET uploaded_at = now(), content_hash = EXCLUDED.content_hash,
         demo = EXCLUDED.demo, judged_as_of = EXCLUDED.judged_as_of`,
      [
        load.id, formatCalendarDate(load.asOfDate), load.type, load.fileNames, args.hash,
        args.demo, formatCalendarDate(args.judgedAsOf),
      ],
    );

    // One statement per table, not one per row. A row-at-a-time loop over 240
    // sales rows is 240 round trips to Singapore: about half a minute, and
    // past a serverless function's time limit on a real 400-SKU file. UNNEST
    // turns each table into a single round trip.
    await c.query(
      `INSERT INTO suppliers (distributor_id, name, region, status)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
       ON CONFLICT (distributor_id) DO UPDATE SET
         name = EXCLUDED.name, region = EXCLUDED.region, status = EXCLUDED.status`,
      columns(dataset.suppliers, (s) => [s.distributorId, s.name, s.region, s.status]),
    );

    await c.query(
      `INSERT INTO sku_master (sku_id, sku_name, category, perishability, standard_reorder_qty, unit_of_measure, distributor_id)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[])
       ON CONFLICT (sku_id) DO UPDATE SET
         sku_name = EXCLUDED.sku_name, category = EXCLUDED.category,
         perishability = EXCLUDED.perishability, standard_reorder_qty = EXCLUDED.standard_reorder_qty,
         unit_of_measure = EXCLUDED.unit_of_measure, distributor_id = EXCLUDED.distributor_id`,
      columns(dataset.skus, (s) => [
        s.skuId, s.name, s.category, s.perishability, s.standardReorderQty, s.unitOfMeasure, s.distributorId,
      ]),
    );

    await c.query(
      `INSERT INTO calendar (year, month, is_festival_month)
       SELECT * FROM UNNEST($1::int[], $2::int[], $3::boolean[])
       ON CONFLICT (year, month) DO UPDATE SET is_festival_month = EXCLUDED.is_festival_month`,
      columns(dataset.calendar, (m) => [m.year, m.month, m.isFestivalMonth]),
    );

    await c.query(
      `INSERT INTO weekly_sales (sku_id, week_label, units, load_id)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[])
       ON CONFLICT (sku_id, week_label) DO UPDATE SET
         units = EXCLUDED.units, load_id = EXCLUDED.load_id`,
      columns(dataset.sales, (s) => [s.skuId, s.weekLabel, s.units, load.id]),
    );

    await c.query(
      `INSERT INTO stock_snapshots (sku_id, location, units_on_hand, as_of_date, load_id)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::date[], $5::text[])
       ON CONFLICT (sku_id, location, as_of_date) DO UPDATE SET
         units_on_hand = EXCLUDED.units_on_hand, load_id = EXCLUDED.load_id`,
      columns(dataset.stock, (s) => [
        s.skuId, s.location, s.unitsOnHand, formatCalendarDate(s.asOfDate), load.id,
      ]),
    );
  });
}

/** Records a blocked attempt, so the archive shows what was refused and why. */
export async function recordBlockedLoad(args: {
  id: string;
  asOfDate: CalendarDate | null;
  type: LoadType;
  fileNames: string[];
  codes: string[];
}): Promise<void> {
  // A load with no readable as-of date still gets a row; the date column cannot
  // be null, so an unreadable file is recorded against the current date and the
  // codes say why it was refused.
  const asOf = args.asOfDate ?? toCalendarDate(new Date());
  await query(
    `INSERT INTO loads (id, as_of_date, type, file_names, status, blocked_codes)
     VALUES ($1, $2, $3, $4, 'blocked', $5)
     ON CONFLICT (id) DO UPDATE SET uploaded_at = now(), blocked_codes = EXCLUDED.blocked_codes`,
    [args.id, formatCalendarDate(asOf), args.type, args.fileNames, args.codes],
  ).catch(() => {
    // Never let archiving a refusal turn into a second failure for the user.
  });
}

export type StoredLoad = {
  id: string;
  uploadedAt: Date;
  asOfDate: CalendarDate;
  type: LoadType;
  fileNames: string[];
  status: "accepted" | "blocked";
  blockedCodes: string[];
  /** A bundled drop, judged against its own snapshot date. */
  demo: boolean;
  /** The clock this load's freshness was measured against. */
  judgedAsOf: CalendarDate | null;
};

export async function listLoads(limit = 25): Promise<StoredLoad[]> {
  const rows = await query<{
    id: string; uploaded_at: Date; as_of_date: Date; type: LoadType;
    file_names: string[]; status: "accepted" | "blocked"; blocked_codes: string[];
    demo: boolean; judged_as_of: Date | null;
  }>(
    `SELECT id, uploaded_at, as_of_date, type, file_names, status, blocked_codes, demo, judged_as_of
       FROM loads ORDER BY uploaded_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    uploadedAt: r.uploaded_at,
    asOfDate: toCalendarDate(r.as_of_date),
    type: r.type,
    fileNames: r.file_names,
    status: r.status,
    blockedCodes: r.blocked_codes ?? [],
    demo: r.demo ?? false,
    judgedAsOf: r.judged_as_of ? toCalendarDate(r.judged_as_of) : null,
  }));
}

export async function acceptedLoadRecords(): Promise<LoadRecord[]> {
  const rows = await query<{
    id: string; uploaded_at: Date; as_of_date: Date; type: LoadType; file_names: string[];
  }>(
    "SELECT id, uploaded_at, as_of_date, type, file_names FROM loads WHERE status = 'accepted' ORDER BY as_of_date DESC",
  );
  return rows.map((r) => ({
    id: r.id,
    uploadedAt: r.uploaded_at.toISOString(),
    asOfDate: toCalendarDate(r.as_of_date),
    type: r.type,
    fileNames: r.file_names,
    status: "accepted" as const,
  }));
}

/** The context a stock-only load reuses. Null when nothing has been loaded. */
export async function storedContext(): Promise<StoredContext | null> {
  const skus = await query<{
    sku_id: string; sku_name: string; category: string; perishability: "Low" | "High";
    standard_reorder_qty: number; unit_of_measure: string; distributor_id: string | null;
  }>("SELECT * FROM sku_master ORDER BY sku_id");
  if (skus.length === 0) return null;

  const suppliers = await query<{ distributor_id: string; name: string; region: string; status: string }>(
    "SELECT * FROM suppliers ORDER BY distributor_id",
  );
  const calendar = await query<{ year: number; month: number; is_festival_month: boolean }>(
    "SELECT * FROM calendar ORDER BY year, month",
  );
  const sales = await query<{ sku_id: string; week_label: string; units: number }>(
    "SELECT sku_id, week_label, units FROM weekly_sales ORDER BY sku_id, week_label",
  );

  return {
    skus: skus.map((s) => ({
      skuId: s.sku_id,
      name: s.sku_name,
      category: s.category,
      perishability: s.perishability,
      standardReorderQty: Number(s.standard_reorder_qty),
      unitOfMeasure: s.unit_of_measure,
      distributorId: s.distributor_id ?? "",
    })),
    suppliers: suppliers.map((s) => ({
      distributorId: s.distributor_id,
      name: s.name,
      region: s.region,
      status: s.status,
    })),
    calendar: calendar.map((c) => ({
      year: Number(c.year),
      month: Number(c.month),
      isFestivalMonth: c.is_festival_month,
    })),
    sales: sales.map((s) => ({ skuId: s.sku_id, weekLabel: s.week_label, units: Number(s.units) })),
  };
}

// ---------------------------------------------------------------- settings

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return row?.value ?? null;
}

/** Writes the value and appends to the history. Both, or neither. */
export async function setSetting(key: string, value: string, changedBy: string): Promise<void> {
  await transaction(async (c) => {
    const previous = await c.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    await c.query(
      `INSERT INTO settings (key, value, changed_by, changed_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, changed_by = EXCLUDED.changed_by, changed_at = now()`,
      [key, value, changedBy],
    );
    await c.query(
      "INSERT INTO settings_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)",
      [key, previous.rows[0]?.value ?? null, value, changedBy],
    );
  });
}
