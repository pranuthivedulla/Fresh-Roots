-- Every email the app tried to send, whether or not it went.
--
-- The daily cap is counted from this table rather than from a counter, so a
-- restart cannot reset it and two functions running at once cannot both think
-- they are under the limit.
--
-- Failures are rows too. An email that silently did not send is worse than
-- one that visibly failed: the whole point of the reminder is that someone
-- notices nothing happened.

CREATE TABLE IF NOT EXISTS email_log (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  to_address   text NOT NULL,
  subject      text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  -- sent, capped, disabled, failed. Only 'sent' counts against the cap.
  status       text NOT NULL CHECK (status IN ('sent', 'capped', 'disabled', 'failed')),
  error        text,
  -- The IST date, so the cap is a day in Raghav's timezone and not in UTC.
  ist_date     date NOT NULL
);

CREATE INDEX IF NOT EXISTS email_log_day_idx ON email_log (ist_date, status);
CREATE INDEX IF NOT EXISTS email_log_kind_idx ON email_log (kind, sent_at DESC);

-- Which weekdays Raghav is expected to upload. Needed before a missed-upload
-- reminder can mean anything: without it the app can say the data is old, but
-- not that an upload was due and did not arrive.
-- 1 = Monday ... 7 = Sunday, ISO. Default Monday (full) and Thursday (stock).
INSERT INTO settings (key, value, changed_by)
VALUES ('run_days', '1,4', 'system')
ON CONFLICT (key) DO NOTHING;
