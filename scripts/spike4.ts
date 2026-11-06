/**
 * Spike 4: email. Sends one real email and proves the daily cap.
 *
 *   node --env-file=.env --experimental-strip-types scripts/spike4.ts
 *   node --env-file=.env --experimental-strip-types scripts/spike4.ts --send
 *
 * Without --send it checks everything except actually posting to the mail
 * provider: configuration, the cap arithmetic, and that a disabled or
 * misconfigured setup fails loudly and is logged rather than silently doing
 * nothing. With --send it sends one message to RAGHAV_EMAIL.
 *
 * Rows it writes to email_log are removed at the end, except the real send,
 * which is left because it is the evidence.
 */

import { closePools, query } from "../lib/db.ts";
import { emailConfig, emailProblems, missedUploadBody, sendEmail, sentToday } from "../lib/email.ts";
import { formatCalendarDate, todayIST } from "../lib/time.ts";

const reallySend = process.argv.includes("--send");
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("Spike 4: email");
console.log("=".repeat(90));

const c = emailConfig();
const problems = emailProblems(c);

console.log("\n1. Configuration");
console.log(`   EMAIL_ENABLED   ${c.enabled}`);
console.log(`   endpoint        ${c.endpoint}`);
console.log(`   from            ${c.from || "(not set)"}`);
console.log(`   to Raghav       ${c.raghav || "(not set)"}`);
console.log(`   to Deepa        ${c.deepa || "(not set)"}`);
console.log(`   cap             ${c.maxPerDay} a day, IST`);
console.log(`   API key         ${c.apiKey ? `set, ${c.apiKey.length} chars` : "(not set)"}`);
if (problems.length > 0) {
  for (const p of problems) console.log(`   note: ${p}`);
}

try {
  console.log("\n2. A disabled or incomplete setup fails loudly, not silently");
  if (problems.length > 0) {
    const r = await sendEmail({ kind: "test", to: c.raghav || "nobody@example.invalid", subject: "spike4", body: "x" });
    check("refused with a reason rather than pretending to send", r.status === "disabled", r.detail);
    const [row] = await query<{ n: string }>(
      "SELECT count(*) AS n FROM email_log WHERE kind = 'test' AND status = 'disabled' AND ist_date = $1",
      [formatCalendarDate(todayIST())],
    );
    check("the refusal was logged", Number(row?.n ?? 0) > 0);
  } else {
    console.log("   email is fully configured, so this case does not apply");
  }

  console.log("\n3. The daily cap");
  const before = await sentToday();
  check("today's count reads from email_log, not a counter", Number.isFinite(before), `${before} sent today`);

  // Fill the log to the cap with rows marked sent, then confirm the next
  // send is refused. The rows are synthetic and removed below.
  const needed = Math.max(0, c.maxPerDay - before);
  if (needed > 0) {
    await query(
      `INSERT INTO email_log (kind, to_address, subject, status, ist_date)
       SELECT 'test', 'cap@example.invalid', 'cap filler', 'sent', $2
         FROM generate_series(1, $1)`,
      [needed, formatCalendarDate(todayIST())],
    );
  }
  const atCap = await sentToday();
  check("the cap is reached", atCap >= c.maxPerDay, `${atCap} of ${c.maxPerDay}`);

  const capped = await sendEmail({
    kind: "test",
    to: c.raghav || "nobody@example.invalid",
    subject: "spike4 cap probe",
    body: "x",
  });
  check(
    "a send at the cap is refused",
    capped.status === "capped" || capped.status === "disabled",
    capped.detail,
  );
  if (problems.length === 0) {
    check("and it is refused for being capped, not for being misconfigured", capped.status === "capped", capped.detail);
  }

  console.log("\n4. Cleaning up the synthetic rows");
  const removed = await query<{ id: string }>(
    "DELETE FROM email_log WHERE kind = 'test' AND to_address IN ('cap@example.invalid', 'nobody@example.invalid') RETURNING id",
  );
  console.log(`   removed ${removed.length}`);
  await query("DELETE FROM email_log WHERE kind = 'test' AND subject = 'spike4 cap probe'");
  check("today's count is back where it started", (await sentToday()) === before, `${await sentToday()} vs ${before}`);

  console.log("\n5. A real send");
  if (!reallySend) {
    console.log("   skipped. Re-run with --send to send one real email.");
  } else if (problems.length > 0) {
    check("cannot send: email is not configured", false, problems.join("; "));
  } else {
    const r = await sendEmail({
      kind: "test",
      to: c.raghav,
      subject: `Freshroots: spike 4 test, ${formatCalendarDate(todayIST())}`,
      body: missedUploadBody({ lastAsOf: null, daysOld: null, dueDay: formatCalendarDate(todayIST()) }),
    });
    check("one real email sent", r.status === "sent", r.detail);
    console.log("   check the inbox. This row is left in email_log as the evidence.");
  }
} catch (err) {
  failures++;
  console.error(`\nFailed: ${(err as Error).message}`);
} finally {
  await query("DELETE FROM email_log WHERE to_address IN ('cap@example.invalid', 'nobody@example.invalid')").catch(() => {});
}

console.log("\n" + "=".repeat(90));
console.log(failures === 0 ? "Spike 4 behaved as specified." : `${failures} check(s) failed.`);
await closePools();
process.exit(failures === 0 ? 0 : 1);
