# Build prompt: Freshroots Demand Planning (Option A)

You are building one web app for a MESA School of Business case ("Deepa's 90-Day Mandate", Freshroots). Read this whole file before writing any code. Ask before choosing anything not covered here. Do not add features that are not in this file.

Items marked **(assumed)** are defaults the owner chose not to confirm. Keep them easy to change (settings or one config file).

---

## 1. The problem and the success measure

Freshroots is an FMCG distributor. Raghav (demand planner) forecasts monthly by hand across about 400 SKUs. Stockouts cost about ₹18-22L and write-offs about ₹10-12L per quarter (₹28-34L total; a management estimate, to be verified).

The app replaces the slow, rule-based part of his work (organising data and applying five documented rules) and leaves judgment to him. It never orders anything. It produces a flagged draft list twice a week; Raghav reviews it and sends the final list to Zoho himself.

**Success (90 days):** reduce quarterly loss by at least ₹5L (about 15-18% of ₹28-34L), compared with the same months last year. A 90-day result shows direction, not proof. Lead indicators: forecast age at order, cycles per month, Raghav's hours per run, rejection rate, rule fidelity, exception share, review adherence.

## 2. Hard constraints

- It must be a working public web app at submission.
- The sample data is the five CSV files in `sample-data/`. The app must work end to end on them.
- Secrets only in `.env`. Put `.env` in `.gitignore` before the first commit. Never print or log keys. Never commit sample passcodes.
- Admin actions (settings, backup checker, pause decisions) are protected by a server-side passcode, never a client-side check.
- If any email is sent, use a dedicated throwaway sending account and a daily cap.
- The app never writes to Zoho or SAP. It only reads uploaded files and exports a CSV.
- Time zone for all dates, weeks and months: Asia/Kolkata (IST).
- Course constraints on model or host are not known **(assumed)**: AI is optional (section 5) and the host defaults to Vercel. Ask if the course says otherwise.

## 3. Stack (assumed defaults)

- Next.js (App Router) with TypeScript and Tailwind.
- Postgres (Supabase or Neon free tier) for all stored data. Do NOT use SQLite or local files for data: serverless hosts do not persist them.
- Deploy to Vercel. Scheduled reminders via Vercel Cron.
- Email (optional): a transactional sender with a throwaway account.
- AI (optional, default OFF): a single provider behind an `AI_ENABLED` flag, used only for one-line exception reasons.

Free-tier limits that can bite: Vercel Hobby cron runs at most once a day and fires anywhere inside the scheduled hour; serverless functions have a short time limit (keep each request light); email providers cap daily sends.

## 4. Workflow (matches components-map-v3.png, column by column)

The map has six columns. Build them in this order.

**1. Trigger**
- Run days are twice a week **(assumed)**: one full export (sales + stock) early in the week and one stock-only upload later in the week. Raghav triggers a run by uploading; the app does not run on its own.
- A daily cron checks whether a run day passed with no upload and sends a missed-upload reminder (banner, plus email if enabled) to Raghav.

**2. Input**
- Raghav exports the file from SAP and saves it. In production this is a "watched folder". On a serverless host a folder cannot be watched, so build it as: (a) an upload drop zone that accepts one or more files and auto-detects which is which, and (b) a "Load sample SAP drop" button that reads the bundled sample CSVs (this is the demo stand-in for SAP).
- Raghav then enters **on-order stock** for each SKU (stock already ordered but not received). There is no PO data. The field is required: an explicit `0` where nothing is open. A blank blocks the run. Pre-fill each SKU from the quantities in the last export the app produced for that SKU (the app knows what was sent), and make Raghav confirm or edit.

**3. Context** (data the app already holds)
- SKU master, supplier list, festival calendar, sales history (kept from earlier loads), and every past load and decision (the archive).

**4. Processing**
- Run the checks (section 5, "Ingest checks").
- Apply the five rules (section 5, "The five rules").
- Route exceptions to the exception queue.
- Archive the load.

**5. AI (optional)**
- For each exception, write one plain line explaining why it was queued. Nothing else (section 5).

**6. Output**
- Draft list: flagged SKUs only, plus the exception queue. In-range SKUs are collapsed under a "No action" count.
- Raghav's review: accept, change quantity (reason required), or reject, per SKU.
- The app logs every action. When he is done, he exports the approved list as CSV and sends it to Zoho himself. A button "I have sent this to Zoho" records the send time. Status wording: "exported" until he confirms, then "sent to Zoho (confirmed by Raghav)". Never "ordered".
- Auto-pause and the RCA view for Deepa (section 7).

## 5. Judgment calls already made (do not re-decide)

### AI versus plain code
Everything is plain code except the optional one-line exception reasons. AI never forecasts, never sets a quantity, never changes a flag, never decides a pause. If `AI_ENABLED` is off, show a code-generated reason instead ("fewer than 12 weeks of history", "week 9 sales are 3.1x this SKU's median").

### Ingest checks (hard filters)
- Required columns present; ISO week labels like `2026-W27` parse; units are non-negative integers.
- `As_Of_Date` in the stock file is read from the file, never from the upload time. Warn if older than 3 days, block if older than 7 **(assumed)**.
- Every load is stored with its file names, as-of date, type (full or stock-only) and status. Re-uploading an old file must not look fresh.
- A stock-only upload reuses the sales history already stored.
- Sales rows are keyed by (SKU, week); a later load replaces an earlier row for the same key.
- A blank on-order cell blocks the run with a clear message.

### The five rules
Let `avg12` = average of the last 12 weeks of sales for the SKU (the window includes the last 4 weeks). Let `avg4` = average of the last 4 weeks.

1. **Weeks of cover** = (units on hand + on-order) / demand, where demand = `avg12`, except as in rules 4 and 5.
2. **Standard SKUs** (Perishability = Low): stockout risk if cover is under 6 weeks; overstock risk if over 14 weeks.
3. **Perishable SKUs** (Perishability = High): stockout risk under 3 weeks; overstock risk over 4 weeks.
4. **High-demand**: if `avg4` is more than 20% above `avg12`, the recommended quantity is 1.5x the standard reorder quantity.
5. **Festival months** (Is_Festival_Month = TRUE in calendar.csv for the run date's month in IST): demand is `avg12 x 1.25` for the cover calculation.

**No stacking:** a SKU that is high-demand (rule 4) uses plain `avg12` for cover (no festival uplift) and takes the 1.5x on quantity. The festival uplift applies only to SKUs that are not high-demand.

**Recommended quantity:** a stockout flag recommends one standard reorder quantity (1.5x if high-demand). An overstock flag recommends holding (quantity 0, status "hold"). In-range SKUs get no recommendation.

Log, for every recommendation, which rules fired and the numbers used (avg12, avg4, uplift applied, cover). Show this in a "why" drawer. This is what lets Deepa test the rules.

### Exceptions (no recommendation, no guess)
A SKU goes to the exception queue instead of getting a recommendation when any of these hold:
- It has fewer than 12 weeks of sales history (new launch).
- Any week in its 12-week window is more than 2x that SKU's median for the window (outlier; **assumed** threshold). Do not silently clean it. Show the week and let Raghav decide.
- Raghav manually moves a SKU into the queue.

The app never infers an unknown. An unknown stays "unknown".

### Review behaviour
- Per SKU: accept, change (reason required, from a pick-list plus optional text), or reject (reason required).
- One-click "accept all flagged" is allowed **(assumed)**, with a confirmation, and the app logs the time spent on the review screen. It does not remove the per-SKU reasons for changes or rejections.
- Rejections are logged by the system by comparing the draft with what Raghav actually exports. Never rely on him to self-report.

### Measures the app computes
Forecast age at order (Zoho send time minus stock `As_Of_Date`), forecast cycles per month, minutes per run, rejection rate, rule fidelity (backtest), exception share, review adherence (reviews done on run days), later-outcome check (below).

### What was dropped (do not build)
The old Supplier Desk, supplier payments, PO creation and approval, "approve all" with no confirmation, the 400-SKU mock data and random-number generator, the landing hub with KPI strips and quick actions, and any AI forecasting.

## 6. What the app must NOT do

- Write to Zoho or SAP, place or approve orders, or create purchase orders.
- Say anything was "ordered".
- Forecast with AI, or let AI change a flag, quantity or pause.
- Silently clean data, guess missing values, or fill a blank on-order cell.
- Let Raghav name or change the backup checker, edit thresholds, or decide a pause.
- Stack the festival uplift on a high-demand SKU.
- Treat an upload time as the data's date.

## 7. Human in the loop

- **Raghav** (reviewer passcode): uploads, enters on-order, reviews, exports, confirms the send.
- **Deepa** (admin passcode, independent reviewer): owns the RCA and decides restart, fix or kill. She is also the project sponsor; the app shows the outcome check beside every verdict so decisions rest on evidence. There is no escalation above her, by choice (known risk).
- **Backup checker**: an empty setting showing "Unassigned". A banner on every screen says "No backup checker named" while it is empty. Only Deepa can edit it (admin passcode), and every change is logged with who and when. It never defaults to Raghav. It does not block go-live.
- **Admin button and caps**: settings and pause decisions need the admin passcode. Email sends are capped per day (`MAX_EMAILS_PER_DAY`).

### Phases and pause rules
Phase comes from a `go_live_date` setting (admin only).

| Phase | Weeks | Behaviour |
|---|---|---|
| Shadow | 1-3 | Runs next to Raghav's manual process. No pause on rejections. Raghav uploads his own manual list after each run so the app can compute the override baseline. Gate: rule fidelity must be 100% on the backtest. |
| Tuning | 4-8 | Pause if rejections exceed 75% of rule-covered recommendations in 2 consecutive reviews. At over 50%, alert Deepa only (no pause). |
| Steady | 9+ | Pause if rejections exceed 25% in 2 consecutive reviews. |
| Always | all | A recorded harm event over ₹2L on one SKU pauses immediately. |

**Rejection rate** = (rejected + changed) / all rule-covered recommendations in one review **(assumed)**. Exceptions are excluded.

**Harm event**: the app has no prices, so Raghav or Deepa records a harm event manually with a rupee value; above ₹2L suspends immediately **(assumed)**.

**When paused**: the app stops showing recommendations to procurement flows, shows "Paused: manual process active", and opens an RCA for Deepa due in 5 working days. No decision means it stays paused. Restart needs Deepa's written note.

**RCA view (Deepa only)**: rejections grouped by rule and by month, each with the numbers used; and the **later-outcome check**: for each rejected or changed recommendation, what happened by the next load two weeks later (stockout, overstock or neither). Outcome rule **(assumed)**: stockout if cover is below the stockout limit, overstock if above the overstock limit, else neither. Verdict choices: fix and restart, redesign, permanent kill.

## 8. Data tables

`sku_master` (SKU_ID, SKU_Name, Category, Perishability, Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID), `suppliers` (Distributor_ID, name, region, status; Distributor_ID is the supplier), `weekly_sales` (SKU_ID, week_label, units, load_id), `stock_snapshots` (SKU_ID, location, units_on_hand, as_of_date, load_id), `calendar` (year, month, is_festival_month), `loads` (id, uploaded_at, as_of_date, type, file_names, status), `runs` (id, load_id, run_at, phase), `on_order` (run_id, SKU_ID, qty, prefilled bool, confirmed_by), `recommendations` (run_id, SKU_ID, avg12, avg4, uplift_applied, cover, flag, qty, rules_fired json, is_exception, exception_reason), `decisions` (recommendation_id, action, final_qty, reason_code, reason_text, decided_at), `exports` (run_id, exported_at, sent_confirmed_at), `harm_events` (id, SKU_ID, value_inr, recorded_by, at), `pauses` (id, trigger, started_at, rca_due_at, verdict, decided_at, note), `outcomes` (recommendation_id, outcome, evaluated_at), `settings` (key, value, changed_by, changed_at).

## 9. Screens and design reference

The structure is `design-reference/components-map-v3.png` (editable source `components-map-v3.svg`). No visual mockup exists yet. Build five plain, readable screens and do not add decoration:

1. **Run**: upload or "Load sample SAP drop", data-as-of banner, on-order entry, results, review and export.
2. **Exceptions**: the queue with reasons.
3. **History and measures**: past loads, decisions and the measures listed in section 5.
4. **Pause and RCA** (Deepa).
5. **Settings** (Deepa): thresholds, festival calendar, go-live date, backup checker, Zoho export columns.

Style **(assumed)**: clean tables, clear flag colours (stockout, overstock, in range), amber for anything needing a human decision, readable on a laptop.

## 10. Operational notes and likely traps

- **Weekly sales, twice-weekly runs.** Sales data is weekly, so a second run in the same week has the same sales; only stock is fresher. Treat the second run as a stock-position check and say so in the UI.
- **Week labels** are ISO weeks (`2026-W27`). Convert them carefully. Weeks and months use IST.
- **Festival month** is decided by the calendar file for the run date's month, which currently ends December 2026.
- **Folder watching** does not work on serverless; use the drop zone and sample button.
- **Cron** on Vercel Hobby fires once a day with loose timing, so reminders are daily, not exact.
- **Ties and rounding:** quantities are whole units; 1.5x is rounded to the nearest whole unit.
- **Perishable and high-demand** can both apply: use perishable limits for flags and 1.5x for quantity.
- **Unreliable inputs:** the on-order value is typed or pre-filled and may be wrong. Validate that it is a non-negative integer.
- **Sample data limits:** one stock snapshot (19 Oct 2026), 16 weeks of sales, no prices, no PO data.

### Acceptance test on the sample data (must match exactly)
Run date in a festival month (October 2026), on-order = 0 for all SKUs.

| SKU | Cover (weeks) | Flag | Recommended |
|---|---|---|---|
| SKU001 (high-demand, no uplift) | 4.2 | Stockout | 750 |
| SKU002 | 11.5 | In range | none |
| SKU003 | 4.4 | Stockout | 300 |
| SKU004 (perishable) | 1.8 | Stockout | 150 |
| SKU005 | 8.1 | In range | none |
| SKU006 | 22.2 | Overstock | hold |
| SKU007 (perishable) | 4.1 | Overstock | hold |
| SKU008 | 7.0 | In range | none |
| SKU009 | 9.4 | In range | none |
| SKU010 | 8.5 | In range | none |
| SKU011 (perishable) | 1.8 | Stockout | 500 |
| SKU012 | 6.8 | In range | none |
| SKU013 | 3.2 | Stockout | 120 |
| SKU014 | 6.8 | In range | none |
| SKU015 | 9.7 | In range | none |

Totals: 5 stockout, 2 overstock, 8 in range. Cover values are rounded to one decimal. Only SKU001 is high-demand (its last 4 weeks are 21.4% above its 12-week average).

## 11. Environment variables (names only)

`DATABASE_URL`, `REVIEWER_PASSCODE`, `ADMIN_PASSCODE`, `SESSION_SECRET`, `AI_ENABLED`, `AI_API_KEY`, `AI_MODEL`, `EMAIL_ENABLED`, `EMAIL_API_KEY`, `EMAIL_FROM`, `RAGHAV_EMAIL`, `DEEPA_EMAIL`, `MAX_EMAILS_PER_DAY`, `CRON_SECRET`, `APP_TIMEZONE`.

## 12. Build order (stop and report after every spike)

1. **Spike 1, rules on the sample files** (plain script, no UI): load the five CSVs, compute the table in section 10, and match it exactly. Report any difference.
2. **Spike 2, ingest checks**: feed it a stale file, a missing column, a bad week label and a blank on-order cell. Each must be blocked with a clear message.
3. **Spike 3, database**: write and read a load, a recommendation and a decision on the hosted Postgres, from a deployed function.
4. **Spike 4, email** (only if `EMAIL_ENABLED`): send one real email from the throwaway account and confirm the daily cap.
5. **Spike 5, cron**: deploy a daily cron that logs a line; confirm it fires and note the timing.

Only then build the app, in this order: ingest and archive, rules and exceptions, review and logging, export and send confirmation, phases and pause, RCA view, settings and banner, measures. Test pause with a synthetic set of rejections in each phase.

## 13. Definition of done

- A public URL works. Loading the sample drop gives the exact table in section 10.
- Raghav's full path works: upload, on-order, review, change with a reason, export, confirm send.
- A synthetic test pauses the app in the tuning phase (above 75% twice) and in steady phase (above 25% twice), and a harm event over ₹2L pauses it immediately.
- Deepa's RCA view shows grouped rejections and the later-outcome check, and a verdict can be recorded with the admin passcode.
- The "No backup checker named" banner shows on every screen while the setting is empty.
- A real email is delivered if email is enabled, and the daily cron is configured.
- The repo is clean: `.env` ignored, no secrets committed, a README that says how to run it, what the demo data is, and what is assumed.

Ask before choosing anything not covered here. Do not add features that are not in this file.
