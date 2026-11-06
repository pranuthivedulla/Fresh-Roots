/**
 * Sending email, with a hard daily cap.
 *
 * Off by default. With EMAIL_ENABLED false the app works exactly as before
 * and every reminder is an in-app banner; nothing here is on the path of a
 * run, so a mail provider being down can never stop Raghav working.
 *
 * Three guards, in order:
 *   1. EMAIL_ENABLED must be true and the settings must be complete
 *   2. the day's sends must be under MAX_EMAILS_PER_DAY, counted in IST from
 *      the email_log table rather than from a counter that a restart resets
 *   3. the provider has to accept it
 *
 * Every attempt is logged, including the ones that were capped or refused.
 * An email that silently did not send is worse than one that visibly failed.
 */

import { query } from "./db.ts";
import { formatCalendarDate, todayIST } from "./time.ts";

export type EmailKind = "missed-upload" | "rejection-alert" | "test";

export type SendResult = {
  status: "sent" | "capped" | "disabled" | "failed";
  detail: string;
};

export type EmailConfig = {
  enabled: boolean;
  apiKey: string;
  from: string;
  raghav: string;
  deepa: string;
  maxPerDay: number;
  /** Overridable so the provider can be swapped without touching this file. */
  endpoint: string;
};

export function emailConfig(): EmailConfig {
  return {
    enabled: (process.env.EMAIL_ENABLED ?? "false").toLowerCase() === "true",
    apiKey: (process.env.EMAIL_API_KEY ?? "").trim(),
    from: (process.env.EMAIL_FROM ?? "").trim(),
    raghav: (process.env.RAGHAV_EMAIL ?? "").trim(),
    deepa: (process.env.DEEPA_EMAIL ?? "").trim(),
    maxPerDay: Number(process.env.MAX_EMAILS_PER_DAY ?? "20") || 20,
    endpoint: (process.env.EMAIL_ENDPOINT ?? "https://api.resend.com/emails").trim(),
  };
}

/** What is missing, as a list. Empty means email is ready to use. */
export function emailProblems(c: EmailConfig = emailConfig()): string[] {
  if (!c.enabled) return ["EMAIL_ENABLED is false, so nothing is sent and reminders are banners only."];
  const missing: string[] = [];
  if (!c.apiKey) missing.push("EMAIL_API_KEY is not set");
  if (!c.from) missing.push("EMAIL_FROM is not set");
  if (!c.raghav) missing.push("RAGHAV_EMAIL is not set");
  if (!c.deepa) missing.push("DEEPA_EMAIL is not set");
  if (!Number.isFinite(c.maxPerDay) || c.maxPerDay <= 0) missing.push("MAX_EMAILS_PER_DAY must be above zero");
  return missing;
}

/** Sends counted against today's cap, in IST. */
export async function sentToday(): Promise<number> {
  const [row] = await query<{ n: string }>(
    "SELECT count(*) AS n FROM email_log WHERE ist_date = $1 AND status = 'sent'",
    [formatCalendarDate(todayIST())],
  );
  return Number(row?.n ?? 0);
}

async function log(args: {
  kind: EmailKind;
  to: string;
  subject: string;
  status: SendResult["status"];
  error?: string;
}): Promise<void> {
  await query(
    `INSERT INTO email_log (kind, to_address, subject, status, error, ist_date)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [args.kind, args.to, args.subject, args.status, args.error ?? null, formatCalendarDate(todayIST())],
  ).catch(() => {
    // Logging must not be the thing that breaks a send path.
  });
}

export async function sendEmail(args: {
  kind: EmailKind;
  to: string;
  subject: string;
  body: string;
  config?: EmailConfig;
}): Promise<SendResult> {
  const c = args.config ?? emailConfig();
  const problems = emailProblems(c);

  if (problems.length > 0) {
    const detail = problems.join("; ");
    await log({ kind: args.kind, to: args.to || "(none)", subject: args.subject, status: "disabled", error: detail });
    return { status: "disabled", detail };
  }
  if (!args.to) {
    const detail = "no recipient address";
    await log({ kind: args.kind, to: "(none)", subject: args.subject, status: "failed", error: detail });
    return { status: "failed", detail };
  }

  const already = await sentToday();
  if (already >= c.maxPerDay) {
    const detail = `the daily cap of ${c.maxPerDay} is reached (${already} sent today, IST)`;
    await log({ kind: args.kind, to: args.to, subject: args.subject, status: "capped", error: detail });
    return { status: "capped", detail };
  }

  try {
    const response = await fetch(c.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: c.from,
        to: [args.to],
        subject: args.subject,
        text: args.body,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      // The provider's message can carry the key back in an echo of the
      // request, so only the status and a short body are kept.
      const text = (await response.text().catch(() => "")).slice(0, 300);
      const detail = `the mail provider returned ${response.status}${text ? `: ${text}` : ""}`;
      await log({ kind: args.kind, to: args.to, subject: args.subject, status: "failed", error: detail });
      return { status: "failed", detail };
    }

    await log({ kind: args.kind, to: args.to, subject: args.subject, status: "sent" });
    return { status: "sent", detail: `sent to ${args.to} (${already + 1} of ${c.maxPerDay} today)` };
  } catch (err) {
    const detail = (err as Error).name === "TimeoutError"
      ? "the mail provider did not answer within 12 seconds"
      : `the mail provider could not be reached: ${(err as Error).message.slice(0, 160)}`;
    await log({ kind: args.kind, to: args.to, subject: args.subject, status: "failed", error: detail });
    return { status: "failed", detail };
  }
}

// ------------------------------------------------------------- the two mails

export function missedUploadBody(args: { lastAsOf: string | null; daysOld: number | null; dueDay: string }): string {
  return [
    `Today is ${args.dueDay}, which is a run day, and no upload has arrived.`,
    "",
    args.lastAsOf
      ? `The newest stock snapshot the app holds is ${args.lastAsOf}, ${args.daysOld} day${args.daysOld === 1 ? "" : "s"} old.`
      : "The app holds no stock snapshot at all.",
    "",
    "Export from SAP and upload it when you can. Nothing has been ordered and nothing will be:",
    "the app only produces a draft list for you to review.",
  ].join("\n");
}

export function rejectionAlertBody(args: { rate: number; limit: number; phase: string }): string {
  return [
    `The last review rejected or changed ${(args.rate * 100).toFixed(0)}% of the recommendations the rules covered.`,
    `That is above the ${(args.limit * 100).toFixed(0)}% alert line for the ${args.phase} phase.`,
    "",
    "Nothing is paused. This is the early warning, not the trigger:",
    "a pause needs two consecutive reviews above the pause limit.",
    "",
    "The rejections are grouped by rule and by month on the Pause and RCA screen,",
    "with what happened to each one two weeks later.",
  ].join("\n");
}
