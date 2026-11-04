# Freshroots Option A (Demand Planning): decision log

Status as of 23 Oct 2026. Items marked (assumed) are not confirmed.

## Nine checks
- 01 Problem real: YES. Stockouts ₹18-22L + write-offs ₹10-12L per quarter (₹28-34L, management estimate, verify in week 1).
- 02 Workflow repeated: YES. Monthly today, twice a week target.
- 03 Input available: YES with risk. 15 SKUs x 16 weeks sales, one stock snapshot (19 Oct), no POs, no prices, no stock history.
- 04 Output valuable: YES. Flag + quantity per SKU, plus an exception queue.
- 05 Impact measurable: YES with risk. Monthly cost vs same month last year; units and SKU-days at risk.
- 08 ROI: YES. ₹15L budget vs ₹1.1-1.4 crore per year exposure.
- 06 Failure risk: YES with guardrail. System recommends only; never writes to Zoho.
- 07 Judgment protected: YES. Raghav reviews every recommendation; 15-20% exceptions are not forecast.
- 09 Owner: YES, conditional on a named backup checker.

## Five pre-build decisions
1. Outcome: reduce quarterly loss by at least ₹5L (about 15-18% of ₹28-34L); lead indicator is forecast age at order.
2. Baseline: ₹28-34L per quarter (to verify); stockout SKU-days and override rate must be created (shadow mode, archive of every load).
3. Workflow change: app replaces organising + five rules; Raghav exports, enters on-order, reviews, sends to Zoho.
4. Measurement (90 days): forecast age at order, cycles per month, Raghav hours per run, monthly cost vs same month last year, override rate, rule fidelity (100% on backtest), exception share, adoption.
5. Kill criterion: auto-pause on rejections of rule-covered recommendations in 2 reviews: over 75% in weeks 1-8 (tuning, owner's call; 50% alerts Deepa only), over 25% from week 9; ₹2L loss on one SKU pauses at any time; RCA in 5 working days by Deepa (independent reviewer; backup not yet named, banner only); Deepa decides restart, fix or kill; no decision = stays paused. No CEO escalation by choice (named as a risk).

## Locked rule sheet
- Weeks of cover = (stock + manual on-order) / 12-week average weekly sales (window includes last 4 weeks).
- Standard: stockout under 6, overstock over 14. Perishable: stockout under 3, overstock over 4.
- High-demand: last-4-week average >20% above 12-week average, order 1.5x.
- Festival months (Oct, Nov, Mar): +25% demand. Festival uplift and 1.5x do NOT stack.
- Stockout reorder = one standard quantity. Distributor_ID = supplier.
- Exceptions (new launches, one-offs, sales outliers) go to a queue with no recommendation.

## Data run (provided files, festival uplift applied)
5 stockout (SKU001, 003, 004, 011, 013), 2 overstock (SKU006, 007), 8 in range.
SKU001 only high-demand (+21.4%, order 750). SKU007 is a judgment call (rising sales, flagged overstock at 4.1 weeks).

## Ingest
Manual export by Raghav into a watched folder (assumed). Freshness guard: warn after 3 days, block after 7 (assumed). Every load archived. Demo uses the 5 provided CSVs.

## Open
- Raghav's time split per step (export, organising, rules, review, Zoho entry).
- Zoho CSV import format.
- "Accept all flagged" button vs per-SKU approval (default: allow, with outcome check).
- Backup checker name.
- Full + stock-only run-day split OK?
- Whether AI is required in the build (default: optional exception reasons only).

## Known risks (named, not fixed)
- Deepa is sponsor and sole RCA reviewer, so she may lean toward restarting. Limit: rules written before launch; outcome check shown beside the verdict.
- No backup and no escalation: if Deepa is away, a pause stays paused.
- Raghav is exporter, entry, reviewer and sender: single point of failure.
- 75% tuning trigger (weeks 1-8) lets weak output run for weeks. Limit: 50% alert to Deepa, rule-fidelity gate, ₹2L trigger always on.

## Settings
- Backup checker: empty field showing 'Unassigned', banner on every screen, editable by Deepa only (server-side passcode), changes logged.
