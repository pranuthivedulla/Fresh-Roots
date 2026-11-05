-- Freshroots demand planning: initial schema.
--
-- The tables are section 8 of the build prompt. Four things are added, each
-- noted inline below with why, because section 8 is otherwise the contract:
--   settings_history   section 7 requires every settings change to be logged
--                      with who and when, and `settings` holds only the latest
--   runs.review_*      section 5 requires minutes per run, which needs the
--                      review screen's start and end
--   loads.content_hash so the same export re-uploaded is recognisable as the
--                      same bytes, not just the same as-of date
--   migrations         the migration runner's own bookkeeping
--
-- All dates and timestamps are IST. Timestamps are stored as timestamptz so the
-- zone is never ambiguous; application code renders them in Asia/Kolkata.
--
-- Nothing in this schema can express an order. There is no purchase order
-- table, no supplier payment, no approval chain. An export is the end of the
-- line, and whether Raghav sent it is a confirmation he records himself.

CREATE TABLE IF NOT EXISTS migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- context

CREATE TABLE IF NOT EXISTS suppliers (
  distributor_id  text PRIMARY KEY,
  name            text NOT NULL,
  region          text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sku_master (
  sku_id                text PRIMARY KEY,
  sku_name              text NOT NULL,
  category              text NOT NULL DEFAULT '',
  -- Low or High only. The flag thresholds depend on it, so it cannot be a guess.
  perishability         text NOT NULL CHECK (perishability IN ('Low', 'High')),
  standard_reorder_qty  integer NOT NULL CHECK (standard_reorder_qty >= 0),
  unit_of_measure       text NOT NULL DEFAULT 'Units',
  distributor_id        text REFERENCES suppliers (distributor_id)
);

CREATE TABLE IF NOT EXISTS calendar (
  year               integer NOT NULL,
  month              integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  is_festival_month  boolean NOT NULL,
  PRIMARY KEY (year, month)
);

-- ------------------------------------------------------------------ loads

CREATE TABLE IF NOT EXISTS loads (
  id            text PRIMARY KEY,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  -- Read from the stock file. Never the upload time: a re-uploaded old export
  -- must not look fresh, and forecast age at order is measured from this.
  as_of_date    date NOT NULL,
  type          text NOT NULL CHECK (type IN ('full', 'stock-only')),
  file_names    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL CHECK (status IN ('accepted', 'blocked')),
  -- added: the same bytes re-uploaded are recognisable as the same bytes
  content_hash  text,
  blocked_codes text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS loads_as_of_idx ON loads (as_of_date DESC);

CREATE TABLE IF NOT EXISTS weekly_sales (
  sku_id      text NOT NULL REFERENCES sku_master (sku_id),
  -- ISO week, e.g. 2026-W27.
  week_label  text NOT NULL CHECK (week_label ~ '^\d{4}-W\d{2}$'),
  units       integer NOT NULL CHECK (units >= 0),
  load_id     text NOT NULL REFERENCES loads (id),
  -- Keyed by (SKU, week): a later load replaces an earlier row for the same key.
  PRIMARY KEY (sku_id, week_label)
);

CREATE TABLE IF NOT EXISTS stock_snapshots (
  sku_id         text NOT NULL REFERENCES sku_master (sku_id),
  location       text NOT NULL DEFAULT '',
  units_on_hand  integer NOT NULL CHECK (units_on_hand >= 0),
  as_of_date     date NOT NULL,
  load_id        text NOT NULL REFERENCES loads (id),
  PRIMARY KEY (sku_id, location, as_of_date)
);

-- ------------------------------------------------------------------- runs

CREATE TABLE IF NOT EXISTS runs (
  id                 text PRIMARY KEY,
  load_id            text NOT NULL REFERENCES loads (id),
  run_at             timestamptz NOT NULL DEFAULT now(),
  phase              text NOT NULL CHECK (phase IN ('shadow', 'tuning', 'steady')),
  -- added: minutes per run is one of the measures, and it needs both ends
  review_started_at  timestamptz,
  review_ended_at    timestamptz
);

CREATE TABLE IF NOT EXISTS on_order (
  run_id        text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  sku_id        text NOT NULL REFERENCES sku_master (sku_id),
  -- NOT NULL on purpose. A blank blocks the run; it is never stored as zero.
  qty           integer NOT NULL CHECK (qty >= 0),
  prefilled     boolean NOT NULL DEFAULT false,
  confirmed_by  text NOT NULL,
  PRIMARY KEY (run_id, sku_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id                bigserial PRIMARY KEY,
  run_id            text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  sku_id            text NOT NULL REFERENCES sku_master (sku_id),
  avg12             numeric(12, 4),
  avg4              numeric(12, 4),
  uplift_applied    numeric(4, 2) NOT NULL DEFAULT 1,
  cover             numeric(12, 4),
  flag              text CHECK (flag IN ('stockout', 'overstock', 'in-range')),
  qty               integer CHECK (qty >= 0),
  -- Which rules fired and the numbers they used. This is what the why drawer
  -- shows and what lets Deepa test the rules rather than trust them.
  rules_fired       jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_exception      boolean NOT NULL DEFAULT false,
  exception_reason  jsonb,
  UNIQUE (run_id, sku_id),
  -- An exception has no verdict and no quantity. A recommendation has a flag.
  CONSTRAINT exception_has_no_verdict CHECK (
    (is_exception AND flag IS NULL AND qty IS NULL AND exception_reason IS NOT NULL)
    OR (NOT is_exception AND flag IS NOT NULL AND exception_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS recommendations_run_idx ON recommendations (run_id);

CREATE TABLE IF NOT EXISTS decisions (
  id                 bigserial PRIMARY KEY,
  recommendation_id  bigint NOT NULL REFERENCES recommendations (id) ON DELETE CASCADE,
  action             text NOT NULL CHECK (action IN ('accept', 'change', 'reject')),
  final_qty          integer CHECK (final_qty >= 0),
  reason_code        text,
  reason_text        text,
  decided_at         timestamptz NOT NULL DEFAULT now(),
  -- A change or a reject must carry a reason. An accept need not.
  CONSTRAINT reason_required CHECK (
    action = 'accept' OR (reason_code IS NOT NULL AND reason_code <> '')
  ),
  UNIQUE (recommendation_id)
);

CREATE TABLE IF NOT EXISTS exports (
  id                 bigserial PRIMARY KEY,
  run_id             text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  exported_at        timestamptz NOT NULL DEFAULT now(),
  -- Set only when Raghav presses "I have sent this to Zoho". Until then the
  -- status word is "exported", never "ordered".
  sent_confirmed_at  timestamptz,
  row_count          integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outcomes (
  recommendation_id  bigint PRIMARY KEY REFERENCES recommendations (id) ON DELETE CASCADE,
  outcome            text NOT NULL CHECK (outcome IN ('stockout', 'overstock', 'neither')),
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  evaluated_load_id  text REFERENCES loads (id)
);

-- --------------------------------------------------------- pause and harm

CREATE TABLE IF NOT EXISTS harm_events (
  id            bigserial PRIMARY KEY,
  sku_id        text REFERENCES sku_master (sku_id),
  value_inr     numeric(14, 2) NOT NULL CHECK (value_inr >= 0),
  recorded_by   text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  note          text
);

CREATE TABLE IF NOT EXISTS pauses (
  id           bigserial PRIMARY KEY,
  trigger      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  rca_due_at   timestamptz NOT NULL,
  -- No verdict means it stays paused. There is no timeout that restarts it.
  verdict      text CHECK (verdict IN ('fix-and-restart', 'redesign', 'permanent-kill')),
  decided_at   timestamptz,
  decided_by   text,
  note         text,
  CONSTRAINT verdict_needs_a_note CHECK (
    verdict IS NULL OR (note IS NOT NULL AND note <> '' AND decided_at IS NOT NULL)
  )
);

-- --------------------------------------------------------------- settings

CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- added: section 7 requires every change logged with who and when, and the
-- table above holds only the latest value.
CREATE TABLE IF NOT EXISTS settings_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  old_value   text,
  new_value   text NOT NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settings_history_key_idx ON settings_history (key, changed_at DESC);

-- The backup checker starts empty and shows "Unassigned". It never defaults to
-- Raghav. The banner stays up while this row is empty.
INSERT INTO settings (key, value, changed_by)
VALUES ('backup_checker', '', 'system')
ON CONFLICT (key) DO NOTHING;
