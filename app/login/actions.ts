"use server";

import { redirect } from "next/navigation";
import { endSession, roleForPasscode, startSession } from "../../lib/auth.ts";

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
