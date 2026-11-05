/**
 * Postgres access. Two connection strings, used for two different things.
 *
 *   DATABASE_URL            pooled. Everything the running app does.
 *   DATABASE_URL_UNPOOLED   direct. Migrations only; a pooled connection
 *                           cannot run them.
 *
 * Nothing in this file prints, logs or returns a connection string. An error
 * about a connection names the host at most, never the credentials.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type Which = "pooled" | "direct";

const ENV_KEY: Record<Which, string> = {
  pooled: "DATABASE_URL",
  direct: "DATABASE_URL_UNPOOLED",
};

/** A connection string, or a clear error saying which variable is missing. */
export function connectionString(which: Which): string {
  const key = ENV_KEY[which];
  const value = process.env[key]?.trim();
  if (!value) {
    throw new MissingEnv(
      `${key} is empty. ${
        which === "pooled"
          ? "This is the Neon POOLED string; its host contains \"-pooler\"."
          : "This is the Neon DIRECT string; its host does NOT contain \"-pooler\". Migrations cannot run on a pooled connection."
      } Put it in .env, which is gitignored.`,
      key,
    );
  }
  return value;
}

export class MissingEnv extends Error {
  // Written out rather than declared as a constructor parameter property:
  // Node's type-stripping runs the file as-is and does not support those.
  key: string;
  constructor(message: string, key: string) {
    super(message);
    this.name = "MissingEnv";
    this.key = key;
  }
}

/** The host of a connection string, safe to print. Returns null if unparseable. */
export function hostOf(which: Which): string | null {
  try {
    return new URL(connectionString(which)).host;
  } catch {
    return null;
  }
}

/** Warns when the two strings look like they were pasted the wrong way round. */
export function checkUrlShapes(): string[] {
  const notes: string[] = [];
  const pooled = hostOf("pooled");
  const direct = hostOf("direct");
  if (pooled && !pooled.includes("-pooler")) {
    notes.push(`DATABASE_URL points at ${pooled}, which has no "-pooler" in the host. That looks like the direct string.`);
  }
  if (direct && direct.includes("-pooler")) {
    notes.push(`DATABASE_URL_UNPOOLED points at ${direct}, which is a pooled host. Migrations will fail on it.`);
  }
  if (pooled && direct && pooled === direct) {
    notes.push(`Both variables point at ${pooled}. One of them is the wrong string.`);
  }
  return notes;
}

const pools = new Map<Which, Pool>();

export function pool(which: Which = "pooled"): Pool {
  let p = pools.get(which);
  if (!p) {
    p = new Pool({
      connectionString: connectionString(which),
      // Neon terminates idle connections; keep the pool small on serverless.
      max: which === "direct" ? 1 : 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    p.on("error", () => {
      // An idle client erroring must not take the process down. The next query
      // reports the real problem.
    });
    pools.set(which, p);
  }
  return p;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  which: Which = "pooled",
): Promise<T[]> {
  const result = await pool(which).query<T>(text, values);
  return result.rows;
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  which: Which = "pooled",
): Promise<T> {
  const client = await pool(which).connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => {})));
  pools.clear();
}
