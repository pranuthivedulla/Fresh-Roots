"use client";

import { useActionState } from "react";

import type { Thresholds } from "../../lib/settings.ts";
import {
  setBackupChecker,
  setExportColumns,
  setGoLiveDate,
  updateThresholds,
  type SettingsResult,
} from "./actions.ts";

const EMPTY: SettingsResult = { ok: false, error: null, message: null };

export function SettingsForms(props: {
  thresholds: Thresholds;
  usingDefaults: boolean;
  backupChecker: string;
  goLiveDate: string;
  exportColumns: string;
}) {
  return (
    <div className="space-y-6">
      <BackupChecker value={props.backupChecker} />
      <GoLive value={props.goLiveDate} />
      <ThresholdForm thresholds={props.thresholds} usingDefaults={props.usingDefaults} />
      <ExportColumns value={props.exportColumns} />
    </div>
  );
}

function Feedback({ state }: { state: SettingsResult }) {
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="text-sm text-emerald-700">{state.message}</p>;
  return null;
}

function BackupChecker({ value }: { value: string }) {
  const [state, action, pending] = useActionState(setBackupChecker, EMPTY);
  return (
    <section className="glass-strong p-3">
      <h3 className="text-sm font-semibold">Backup checker</h3>
      <p className="mb-2 text-sm text-slate-600">
        Who reviews a pause if Deepa is unavailable. Empty shows &ldquo;Unassigned&rdquo; and puts a
        banner on every screen. It never defaults to Raghav, and it does not block go-live.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          defaultValue={value}
          placeholder="Nobody named"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <div className="mt-2">
        <Feedback state={state} />
      </div>
    </section>
  );
}

function GoLive({ value }: { value: string }) {
  const [state, action, pending] = useActionState(setGoLiveDate, EMPTY);
  return (
    <section className="glass-strong p-3">
      <h3 className="text-sm font-semibold">Go-live date</h3>
      <p className="mb-2 text-sm text-slate-600">
        Weeks 1&ndash;3 are shadow (never pauses on rejections), 4&ndash;8 tuning (pauses above 75%
        in two consecutive reviews, alerts above 50%), 9 onwards steady (pauses above 25%). A harm
        event over &#8377;2L pauses in any phase.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="go_live_date"
          type="date"
          defaultValue={value}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <div className="mt-2">
        <Feedback state={state} />
      </div>
    </section>
  );
}

function ThresholdForm({ thresholds, usingDefaults }: { thresholds: Thresholds; usingDefaults: boolean }) {
  const [state, action, pending] = useActionState(updateThresholds, EMPTY);
  const t = thresholds;
  return (
    <section className="glass-strong p-3">
      <h3 className="text-sm font-semibold">Thresholds</h3>
      <p className="mb-3 text-sm text-slate-600">
        {usingDefaults
          ? "Currently the locked rule sheet, unchanged since the build."
          : "Changed from the locked rule sheet. The change log below says by whom."}{" "}
        These apply to the next run. Recommendations already produced keep the numbers they were
        produced with, so an old draft never silently changes meaning.
      </p>
      <form action={action} className="space-y-4">
        <Group title="Standard SKUs (Perishability = Low), weeks of cover">
          <Field name="standard_stockout" label="Stockout under" value={t.standard.stockoutUnder} />
          <Field name="standard_overstock" label="Overstock over" value={t.standard.overstockOver} />
        </Group>
        <Group title="Perishable SKUs (Perishability = High), weeks of cover">
          <Field name="perishable_stockout" label="Stockout under" value={t.perishable.stockoutUnder} />
          <Field name="perishable_overstock" label="Overstock over" value={t.perishable.overstockOver} />
        </Group>
        <Group title="Rule 4, high demand">
          <Field name="high_demand_pct" label="Recent average above 12-week by (%)" value={t.highDemandAbovePct} />
          <Field name="high_demand_multiplier" label="Quantity multiplier" value={t.highDemandMultiplier} step="0.1" />
        </Group>
        <Group title="Rule 5, festival months">
          <Field name="festival_uplift_pct" label="Demand uplift (%)" value={t.festivalUpliftPct} />
        </Group>
        <Group title="Windows and exceptions">
          <Field name="cover_window" label="Cover window (weeks)" value={t.coverWindowWeeks} />
          <Field name="recent_window" label="Recent window (weeks)" value={t.recentWindowWeeks} />
          <Field name="outlier_multiple" label="Outlier above this × median" value={t.outlierMultipleOfMedian} step="0.1" />
        </Group>
        <Group title="Data freshness (days)">
          <Field name="stale_warn" label="Warn after" value={t.staleWarnDays} />
          <Field name="stale_block" label="Block after" value={t.staleBlockDays} />
        </Group>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save thresholds"}
        </button>
        <Feedback state={state} />
      </form>
    </section>
  );
}

function ExportColumns({ value }: { value: string }) {
  const [state, action, pending] = useActionState(setExportColumns, EMPTY);
  return (
    <section className="glass-strong p-3">
      <h3 className="text-sm font-semibold">Zoho export columns</h3>
      <p className="mb-2 text-sm text-slate-600">
        The order of columns in the CSV. Available: SKU_ID, SKU_Name, Distributor_ID, Quantity,
        Unit_of_Measure.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="columns"
          defaultValue={value}
          className="w-full max-w-xl rounded border border-slate-300 px-2 py-1 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <div className="mt-2">
        <Feedback state={state} />
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-slate-600">{title}</legend>
      <div className="flex flex-wrap gap-3">{children}</div>
    </fieldset>
  );
}

function Field({
  name,
  label,
  value,
  step = "1",
}: {
  name: string;
  label: string;
  value: number;
  step?: string;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <input
        name={name}
        type="number"
        step={step}
        defaultValue={value}
        className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}
