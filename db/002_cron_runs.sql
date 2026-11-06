-- A record of every scheduled job that fired.
--
-- Vercel's Hobby plan keeps runtime logs only briefly, and a cron that fires
-- "anywhere inside the scheduled hour" cannot be watched live. Writing a row
-- makes "did it fire, and when exactly" a question the status page can answer
-- a week later instead of a question about log retention.

CREATE TABLE IF NOT EXISTS cron_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  -- What the job found. For the missed-upload check: how stale the newest
  -- accepted load was when it ran.
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- false when the job ran but could not do its work.
  ok          boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS cron_runs_job_idx ON cron_runs (job, ran_at DESC);
