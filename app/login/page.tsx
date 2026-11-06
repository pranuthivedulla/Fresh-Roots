import { redirect } from "next/navigation";

import { currentSession, demoModeEnabled, passcodesConfigured } from "../../lib/auth.ts";
import { DemoSignIn } from "./DemoSignIn.tsx";
import { LoginForm } from "./LoginForm.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  const configured = passcodesConfigured();
  const neither = !configured.reviewer && !configured.admin;
  const demo = demoModeEnabled();

  return (
    <main className="mx-auto max-w-sm">
      <h2 className="mb-1 text-base font-semibold">Sign in</h2>
      <p className="mb-4 text-sm text-slate-600">
        Raghav&rsquo;s passcode opens the run and review screens. Deepa&rsquo;s also opens settings,
        pauses and the RCA.
      </p>

      {neither ? (
        <p className="glass glass-red p-3 text-sm text-red-900">
          No passcodes are configured on this deployment, so nobody can sign in. Set
          REVIEWER_PASSCODE and ADMIN_PASSCODE in the environment.
        </p>
      ) : (
        <LoginForm />
      )}

      {demo && (
        <section className="glass glass-amber mt-6 p-3 text-sm text-amber-900">
          <h3 className="font-semibold">Assessing this app?</h3>
          <p className="mt-1">
            Go in without a passcode. The passcode is not removed and nothing is unlocked: the
            server issues a normal session, so both roles behave exactly as they do for Raghav and
            Deepa. Deepa sees two screens Raghav does not.
          </p>
          <div className="mt-2">
            <DemoSignIn />
          </div>
        </section>
      )}
    </main>
  );
}
