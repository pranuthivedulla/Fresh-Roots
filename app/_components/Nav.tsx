import Link from "next/link";

import { describeRole, type Role } from "../../lib/auth.ts";
import { signOut } from "../login/actions.ts";

const SCREENS: { href: string; label: string; needs: Role }[] = [
  { href: "/", label: "Run", needs: "reviewer" },
  { href: "/exceptions", label: "Exceptions", needs: "reviewer" },
  { href: "/history", label: "History and measures", needs: "reviewer" },
  { href: "/rca", label: "Pause and RCA", needs: "admin" },
  { href: "/settings", label: "Settings", needs: "admin" },
  { href: "/status", label: "Status", needs: "reviewer" },
];

export function Nav({ role }: { role: Role }) {
  const visible = SCREENS.filter((s) => s.needs === "reviewer" || role === "admin");
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 pb-3 text-sm">
      {visible.map((s) => (
        <Link key={s.href} href={s.href} className="text-neutral-700 underline-offset-2 hover:underline">
          {s.label}
        </Link>
      ))}
      <span className="ml-auto text-neutral-500">{describeRole(role)}</span>
      <form action={signOut}>
        <button type="submit" className="text-neutral-700 underline underline-offset-2">
          Sign out
        </button>
      </form>
    </nav>
  );
}
