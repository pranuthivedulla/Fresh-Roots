import { redirect } from "next/navigation";

import { currentSession, passcodesConfigured } from "../../lib/auth.ts";
import { LoginForm } from "./LoginForm.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  const configured = passcodesConfigured();
  const neither = !configured.reviewer && !configured.admin;

  return (
    <main className="mx-auto max-w-sm">
      <h2 className="mb-1 text-base font-semibold">Sign in</h2>
      <p className="mb-4 text-sm text-neutral-600">
        Raghav&rsquo;s passcode opens the run and review screens. Deepa&rsquo;s also opens settings,
        pauses and the RCA.
      </p>

      {neither ? (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          No passcodes are configured on this deployment, so nobody can sign in. Set
          REVIEWER_PASSCODE and ADMIN_PASSCODE in the environment.
        </p>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
