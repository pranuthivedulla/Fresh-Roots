-- Which clock a load was judged against.
--
-- A bundled demo drop is measured against its own snapshot date, because the
-- sample data cannot move and the 7-day freshness rule would otherwise block
-- every demo. A real upload is measured against the real IST clock.
--
-- Without recording which happened, the Run screen contradicts itself: it
-- accepts the sample drop and then tells Raghav the data is 18 days old and
-- over the limit. Age is now always (judged_as_of - as_of_date), using the
-- same clock that decided whether to accept the load.

ALTER TABLE loads ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT false;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS judged_as_of date;

-- Existing rows were all real-clock judgements or demo drops from before this
-- column existed; leaving judged_as_of null makes the screen fall back to the
-- real clock, which is the safe direction.
