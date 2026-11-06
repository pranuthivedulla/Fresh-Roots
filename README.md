# Freshroots demand planning

A twice-weekly draft order list for a human to review.

Raghav forecasts by hand across about 400 SKUs. This app does the slow,
rule-based part — organising the data and applying five documented rules — and
leaves every judgment to him. It produces a flagged list; he reviews it, changes
what he disagrees with, exports a CSV and sends it to Zoho himself.

**It never orders anything.** It does not write to Zoho or SAP, does not create
or approve purchase orders, and never uses the word "ordered". The status wording
is "exported" until Raghav confirms he has sent it, and then "sent to Zoho
(confirmed by Raghav)".

Built for the MESA School of Business case "Deepa's 90-Day Mandate". The full
specification is [CLAUDE_CODE_BUILD_PROMPT.md](CLAUDE_CODE_BUILD_PROMPT.md); the
decision log behind it is [nine-checks.md](nine-checks.md).

---

## Status

| Piece | State |
|---|---|
| Rules engine | Built. Reproduces the section 10 acceptance table exactly |
| Ingest gates | Built. 17 of 17 cases block or pass as specified |
| Database schema | Built. Not yet run against a hosted Postgres |
| Deployable skeleton | Built. Status page, health route, self-test route |
| Sessions | Built. Two passcodes, server-side, signed cookie |
| Run screen | Built: load, on-order, rules, review, export, send confirmation |
| Exceptions, History, RCA, Settings | **Not built** |
| Email, cron | **Not built**. Both default off |

Run `npm run spike1` and `npm run spike2` to see the first two for yourself;
neither needs a database, a key or a network.

---

## Running it

Needs Node 22.6 or newer (the scripts use Node's built-in TypeScript stripping).

```
npm install
npm run spike1      # the five rules against the sample files
npm run spike2      # the ingest gates against nine broken drops
```

For anything that touches the database, copy `.env.example` to `.env` and fill
it in, then:

```
npm run migrate     # applies db/*.sql once each, on the DIRECT connection
npm run spike3      # writes and reads a load, recommendation and decision
npm run dev         # http://localhost:3000
```

`.env` is gitignored and must never be committed.

### Checks

```
npm run typecheck
npm run build
npm run fixtures    # regenerates tests/fixtures/ from sample-data/
```

### If `npm run dev` goes strange

This folder lives inside OneDrive, which syncs `.next` and `node_modules`
while the dev server is writing them. The symptom is buttons that silently do
nothing: the page renders, but `main-app.js` and `app-pages-internals.js`
come back 404, so React never hydrates and no click handler is attached.
Hot reload makes it worse, because each rebuild rewrites files mid-sync.

Three ways out, best first:

1. Move the project out of OneDrive, for example `C:\dev\freshroots`.
2. Exclude `.next` and `node_modules` from OneDrive sync.
3. Test against a production build instead, which does not hot reload:
   `npm run build && npm start`.

`npm run build` has never been affected; it is only the dev server.

---

## The demo data

`sample-data/` holds the five CSV files from the case. They are real inputs, not
mock data, and nothing in the app generates numbers.

| File | What it is |
|---|---|
| `sku_master.csv` | 15 SKUs: perishability, standard reorder quantity, distributor |
| `weekly_sales.csv` | 16 ISO weeks, `2026-W27` to `2026-W42` |
| `current_inventory.csv` | One stock snapshot, 19 Oct 2026 |
| `distributor_master.csv` | Four distributors. The distributor is the supplier |
| `calendar.csv` | Festival months to December 2026 |

There are no prices, no purchase-order data and no stock history. The app does
not invent any of them.

**Load sample SAP drop** reads these files. In production Raghav exports from SAP
into a watched folder; a serverless host cannot watch a folder, so the app offers
an upload drop zone and this button instead.

`tests/fixtures/` holds generated test data, never mixed with the case data:
nine broken drops that must each block a run, and an edge-case drop with three
invented SKUs that exercise the exception queue (the real sample data produces
no exceptions at all).

---

## The five rules

`avg12` is the average of the last 12 weeks of sales for a SKU; `avg4` the last 4.

1. **Weeks of cover** = (units on hand + on order) / demand.
2. **Standard** SKUs (Perishability `Low`): stockout under 6 weeks, overstock over 14.
3. **Perishable** SKUs (Perishability `High`): stockout under 3, overstock over 4.
4. **High-demand**: `avg4` more than 20% above `avg12` → quantity is 1.5x the standard reorder quantity.
5. **Festival month**: demand = `avg12` x 1.25 for the cover calculation.

**The uplift never stacks on the multiplier.** A high-demand SKU uses plain
`avg12` for cover and takes the 1.5x on quantity.

A SKU goes to the **exception queue** with no recommendation when it has fewer
than 12 weeks of history, when any week in its window is more than 2x that SKU's
median, or when Raghav moves it there. The app never infers an unknown.

Every recommendation records which rules fired and the numbers they used. That
is what the "why" drawer shows, and it is what lets Deepa test the rules rather
than trust them.

### Acceptance test

Run as of 19 Oct 2026 (a festival month) with on-order 0 everywhere, the sample
data must produce exactly 5 stockout, 2 overstock and 8 in range, with SKU001 the
only high-demand SKU. `npm run spike1` checks all 15 rows, the three totals and
the high-demand list against [tests/section10.ts](tests/section10.ts) and exits
non-zero on any difference.

---

## What is assumed

Items the build prompt marked **(assumed)**, kept easy to change:

- **Run days are twice a week** — one full export early in the week, one
  stock-only upload later. Raghav triggers a run by uploading; the app never
  runs on its own.
- **Freshness**: warn when the stock snapshot is over 3 days old, block over 7.
- **Outlier threshold**: a week above 2x the SKU's 12-week median.
- **Rejection rate** = (rejected + changed) / rule-covered recommendations in one
  review. Exceptions are excluded.
- **Harm event**: recorded by hand with a rupee value; above ₹2L pauses immediately.
- **"Accept all flagged"** is allowed, with a confirmation. It does not remove
  the per-SKU reason required for a change or a reject.
- **Style**: plain tables, flag colours only where they carry meaning, amber for
  anything needing a human decision.

Every threshold above lives in [lib/settings.ts](lib/settings.ts) and belongs to
Deepa (admin passcode). Nothing else in the codebase hard-codes one.

### Decisions taken during the build

- **A sample drop runs as of its own snapshot date** (19 Oct 2026). The snapshot
  does not move, so measuring its age against the real clock would block the
  demo under the app's own 7-day rule. A real upload is always measured against
  the real IST clock. This is the only place the two differ.
- **Two exception kinds were added** beyond the three in the specification:
  `unknown-stock` (a SKU in the master with no row in the stock file) and
  `zero-demand` (no sales in the window, so cover cannot be computed). Both exist
  because the alternative is inferring a zero, which the specification forbids.
- **Four tables were added** beyond section 8, each annotated in
  [db/001_init.sql](db/001_init.sql): `settings_history` (section 7 requires every
  settings change logged, and `settings` holds only the latest value),
  `runs.review_started_at` / `review_ended_at` (minutes per run needs both ends),
  `loads.content_hash`, and `migrations`.
- **The rules that must not be broken are database constraints**, not only
  application code: an exception cannot carry a flag or a quantity, a change or
  a reject cannot be saved without a reason, a pause verdict needs a note, and
  `on_order.qty` is `NOT NULL` so a blank can never land as a zero.

### Known, not fixed

- **The perishable in-range band is one week wide** (cover between 3 and 4
  weeks), so nearly every perishable SKU is flagged on nearly every run. All
  three perishables in the sample data are flagged and none is in range. This
  follows the locked rule sheet; the shadow-phase backtest is where it should be
  decided.
- **The festival calendar ends December 2026.** A run after that treats the
  month as not a festival month and says so in a banner. An absent row is not a
  confirmed FALSE.
- **2026 has 53 ISO weeks.** The date helpers handle it; anything reading week
  labels as strings would not.

---

## Access

Two shared passcodes, checked server-side, never in the browser.

- **Raghav** (`REVIEWER_PASSCODE`): uploads, enters on-order, reviews, exports,
  confirms the send.
- **Deepa** (`ADMIN_PASSCODE`): settings, thresholds, the backup checker, pause
  decisions and RCA verdicts. She is the independent reviewer and the sponsor.

The **backup checker** starts empty and shows "Unassigned". A banner appears on
every screen while it is empty. Only Deepa can set it, every change is logged
with who and when, and it never defaults to Raghav. It does not block go-live.

There is no escalation above Deepa. That is a deliberate choice and a named
risk: if she is away, a paused system stays paused.

---

## Environment variables

See [.env.example](.env.example) for the full list with notes. Nothing is
printed or logged. Two connection strings are needed because a pooled connection
cannot run schema migrations:

- `DATABASE_URL` — pooled, used by the running app
- `DATABASE_URL_UNPOOLED` — direct, used by migrations only

AI (`AI_ENABLED`) and email (`EMAIL_ENABLED`) both default off and the app works
fully without either. AI, when on, writes one plain line explaining why a SKU was
queued as an exception. It never forecasts, never sets a quantity, never changes
a flag and never decides a pause.

---

## Deploying

Vercel, with the database provisioned through Vercel's Neon integration so the
connection strings are set in one place and pulled locally with
`npx vercel env pull .env`.

Two routes exist to prove a deployment works:

- `GET /api/health` — public, read-only. 503 until the schema is migrated.
  Discloses no business data and no connection string.
- `POST /api/selftest` — requires `Authorization: Bearer $CRON_SECRET`. Writes a
  load, run, on-order, recommendation and decision, reads them back, probes a
  constraint, then rolls the whole transaction back.

Vercel's Hobby plan runs cron at most once a day and fires anywhere inside the
scheduled hour, so the missed-upload reminder is daily, not exact.
