/**
 * Who is using the app: Raghav (reviewer) or Deepa (admin).
 *
 * A passcode is checked on the server and never reaches the browser. What the
 * browser holds is a cookie carrying a role and an expiry, signed with
 * SESSION_SECRET, so it can be read back but not forged or edited.
 *
 * Checks are per page and per action, deliberately NOT in middleware. Next's
 * middleware has a history of auth-bypass bugs (CVE-2025-29927), and a check
 * that lives next to the thing it protects cannot be skipped by a request that
 * never reaches the middleware.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type Role = "reviewer" | "admin";

export const COOKIE_NAME = "freshroots_session";
const MAX_AGE_SECONDS = 12 * 60 * 60; // one working day

export type Session = { role: Role; expiresAt: number };

/** Admin can do everything a reviewer can. Nobody else can do admin things. */
export function roleAllows(role: Role, needed: Role): boolean {
  return needed === "reviewer" ? true : role === "admin";
}

export function describeRole(role: Role): string {
  return role === "admin" ? "Deepa (admin)" : "Raghav (reviewer)";
}

/** The role a passcode unlocks, or null. Admin is checked first. */
export function roleForPasscode(passcode: string): Role | null {
  const given = passcode.trim();
  if (given === "") return null;
  // Both are compared every time, so the answer does not come back faster
  // for a wrong reviewer passcode than for a wrong admin one.
  const isAdmin = matches(given, process.env.ADMIN_PASSCODE);
  const isReviewer = matches(given, process.env.REVIEWER_PASSCODE);
  if (isAdmin) return "admin";
  if (isReviewer) return "reviewer";
  return null;
}

/** True when a passcode is configured at all. An unset passcode never matches. */
export function passcodesConfigured(): { reviewer: boolean; admin: boolean } {
  return {
    reviewer: (process.env.REVIEWER_PASSCODE ?? "").trim() !== "",
    admin: (process.env.ADMIN_PASSCODE ?? "").trim() !== "",
  };
}

function matches(given: string, expected: string | undefined): boolean {
  const want = (expected ?? "").trim();
  if (want === "") return false; // an unset passcode must not be guessable as ""
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ----------------------------------------------------------------- cookie

function secret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.trim() === "") {
    throw new Error("SESSION_SECRET is not set, so sessions cannot be signed.");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(value: string): Session | null {
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = value.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (parsed.role !== "reviewer" && parsed.role !== "admin") return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function startSession(role: Role): Promise<void> {
  const session: Session = { role, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 };
  (await cookies()).set(COOKIE_NAME, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** The current session, or null. Never throws on a bad or absent cookie. */
export async function currentSession(): Promise<Session | null> {
  try {
    const raw = (await cookies()).get(COOKIE_NAME)?.value;
    return raw ? decode(raw) : null;
  } catch {
    return null;
  }
}

export class NotAuthorised extends Error {
  needed: Role;
  constructor(needed: Role) {
    super(needed === "admin" ? "This needs Deepa's admin passcode." : "Please sign in.");
    this.name = "NotAuthorised";
    this.needed = needed;
  }
}

/**
 * Use at the top of every protected page and every server action.
 * Throws rather than returning a falsy value, so a forgotten `if` cannot
 * turn into an unprotected action.
 */
export async function requireRole(needed: Role): Promise<Session> {
  const session = await currentSession();
  if (!session || !roleAllows(session.role, needed)) throw new NotAuthorised(needed);
  return session;
}
