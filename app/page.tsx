import { redirect } from "next/navigation";

import { currentSession } from "../lib/auth.ts";
import { listLoads, type StoredLoad } from "../lib/repo.ts";
import { daysBetween, formatCalendarDate, isoWeekLabelOf, todayIST } from "../lib/time.ts";
import { DropForm } from "./DropForm.tsx";

export const dynamic = "force-dynamic";

/**
 * The Run screen. Step one of it: get a drop in, check it, archive it.
 *
 * On-order entry, the rules and the review come next; until they exist this
 * screen stops after the load, and says so rather than implying more happened.
 */
export default async function RunPage() {
  const session = await currentSession();
  if (!session) redirect("/login");

  let loads: StoredLoad[] = [];
  let loadError: string | null = null;
  try {
    loads = await listLoads(10);
  } catch (err) {
    loadError = (err as Error).message.split("\n")[0]!;
  }
  const newest = loads.find((l) => l.status === "accepted") ?? null;
  const today = todayIST();

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">Run</h2>
        <p className="text-sm text-neutral-600">
          Today is {formatCalendarDate(today)} ({isoWeekLabelOf(today)}), IST.
        </p>
      </section>

      {newest ? (
        <DataAsOf load={newest} today={today} />
      ) : (
        <p className="rounded border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
          Nothing has been loaded yet. The app holds no sales history, so the first load must be a
          full one.
        </p>
      )}

      <DropForm />

      <section className="border-t border-neutral-200 pt-4">
        <h3 className="mb-1 text-sm font-semibold">Archive</h3>
        <p className="mb-3 text-sm text-neutral-600">
          Every load is kept, including the ones that were refused, so a re-uploaded old export
          cannot look fresh.
        </p>
        {loadError ? (
          <p className="text-sm text-red-700">The archive could not be read: {loadError}</p>
        ) : loads.length === 0 ? (
          <p className="text-sm text-neutral-500">No loads yet.</p>
        ) : (
          <table className="w-full border-y border-neutral-200 text-left text-sm">
            <thead className="text-neutral-600">
              <tr>
                <Th>Uploaded (IST)</Th>
                <Th>Data as of</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Files</Th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100 align-top">
                  <Td>{istStamp(l.uploadedAt)}</Td>
                  <Td>{formatCalendarDate(l.asOfDate)}</Td>
                  <Td>{l.type === "full" ? "full" : "stock only"}</Td>
                  <Td>
                    {l.status === "accepted" ? (
                      <span className="text-emerald-700">accepted</span>
                    ) : (
                      <span className="text-red-700">
                        blocked{l.blockedCodes.length > 0 ? `: ${l.blockedCodes.join(", ")}` : ""}
                      </span>
                    )}
                  </Td>
                  <Td className="text-neutral-600">{l.fileNames.join(", ")}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="rounded border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
        <strong className="font-semibold">Not built yet:</strong> on-order entry, the five rules
        against this data, the review and the export. This screen currently stops once a load is
        accepted and archived.
      </p>
    </main>
  );
}

function DataAsOf({ load, today }: { load: StoredLoad; today: ReturnType<typeof todayIST> }) {
  // Age is measured against the clock this load was judged by, so the banner
  // cannot contradict the decision to accept it. For a real upload that is
  // today; for a bundled demo drop it is the drop's own snapshot date.
  const against = load.judgedAsOf ?? today;
  const age = daysBetween(load.asOfDate, against);
  const tone =
    age > 7
      ? "border-red-300 bg-red-50 text-red-900"
      : age > 3
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-neutral-300 bg-white text-neutral-800";
  return (
    <section className={`rounded border p-3 text-sm ${tone}`}>
      <strong className="font-semibold">
        Data as of {formatCalendarDate(load.asOfDate)} ({isoWeekLabelOf(load.asOfDate)})
      </strong>{" "}
      — {age === 0 ? "the day it was judged against" : `${age} day${age === 1 ? "" : "s"} old`}, read
      from the stock file and never from the upload time.
      {age > 7 && " Over the 7-day limit: a new run needs a fresh export."}
      {age > 3 && age <= 7 && " Over 3 days, so the cover figures lag reality."}
      {load.demo && (
        <span className="mt-1 block text-neutral-600">
          This is bundled demo data. It is judged as of its own snapshot date, because the sample
          files cannot move. A real upload is always measured against today
          {" "}({formatCalendarDate(today)}), under which this drop would be{" "}
          {daysBetween(load.asOfDate, today)} days old and refused.
        </span>
      )}
    </section>
  );
}

function istStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 pr-4 font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2 pr-4 ${className}`}>{children}</td>;
}
