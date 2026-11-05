import type { Metadata } from "next";
import { appStatus } from "../lib/status.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots demand planning",
  description: "Flagged draft lists for a human reviewer. Recommends only; never orders.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const status = await appStatus();
  const backupCheckerMissing = !status.backupChecker || status.backupChecker.trim() === "";

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Section 7: this banner shows on every screen while the setting is
            empty. It never defaults to Raghav and it does not block go-live. */}
        {backupCheckerMissing && (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <strong className="font-semibold">No backup checker named.</strong> If Deepa is
            unavailable, a paused system stays paused. Only Deepa can set this, in Settings.
          </div>
        )}
        {!status.database.reachable && (
          <div
            role="alert"
            className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900"
          >
            <strong className="font-semibold">The database is not reachable:</strong>{" "}
            {status.database.error}. Nothing can be run or saved until this is fixed.
          </div>
        )}
        <div className="mx-auto max-w-5xl px-4 py-6">
          <header className="mb-6 border-b border-neutral-200 pb-4">
            <h1 className="text-lg font-semibold">Freshroots demand planning</h1>
            <p className="text-sm text-neutral-600">
              Produces a flagged draft list for review. It never orders anything and never writes
              to Zoho or SAP.
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
