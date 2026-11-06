"use server";

import { redirect } from "next/navigation";
import { demoModeEnabled, endSession, roleForPasscode, startSession, type Role } from "../../lib/auth.ts";

export type LoginState = { error: string | null };

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const passcode = String(formData.get("passcode") ?? "");
  const role = roleForPasscode(passcode);
  if (!role) {
    // One message for every failure. Saying which passcode was wrong, or that
    // one is unset, tells an attacker something they did not know.
    return { error: "That passcode was not recognised." };
  }
  await startSession(role);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/login");
}

/**
 * Signs a visitor in without a passcode, only while DEMO_MODE is true.
 * The role is still a real session issued by the server, so every screen and
 * every action behaves exactly as it does for Raghav or Deepa.
 */
export async function signInForDemo(role: Role): Promise<void> {
  if (!demoModeEnabled()) {
    throw new Error("Demo mode is off on this deployment.");
  }
  await startSession(role);
  redirect("/");
}
