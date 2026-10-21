import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { MIGRATIONS } from "./migrations";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

// One client per server instance. On Vercel, DATABASE_URL points at Neon's
// pooled endpoint, so prepared statements are disabled (PgBouncer).
// Without DATABASE_URL we fall back to an embedded PGlite database on local disk.
const globalForDb = globalThis as unknown as { __dapDb?: Promise<DB> };

export function db(): Promise<DB> {
  globalForDb.__dapDb ??= connect().catch((err) => {
    globalForDb.__dapDb = undefined; // retry on the next request instead of caching the failure
    throw err;
  });
  return globalForDb.__dapDb;
}

export function databaseKind(): "postgres" | "pglite" {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

async function connect(): Promise<DB> {
  let instance: DB;
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 5 });
    instance = drizzlePostgres({ client, schema });
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const dataDir = process.env.PGLITE_DIR ?? "./.data/pglite";
    if (dataDir !== "memory://") {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dataDir, { recursive: true });
    }
    const client = new PGlite(dataDir === "memory://" ? undefined : dataDir, { extensions: { vector } });
    // Both drivers expose the same query builder surface; only the client differs.
    instance = drizzlePglite({ client, schema }) as unknown as DB;
  }
  await migrate(instance);
  return instance;
}

async function migrate(instance: DB) {
  await instance.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied = new Set(
    (await rows<{ id: string }>(instance, sql`SELECT id FROM schema_migrations`)).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await instance.transaction(async (tx) => {
      // One statement per call: PGlite runs execute() as a prepared statement.
      for (const statement of m.sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql`INSERT INTO schema_migrations (id) VALUES (${m.id})`);
    });
  }
}

/** Runs raw SQL and normalises the result shape across postgres-js and PGlite. */
export async function rows<T>(instance: DB, query: SQL): Promise<T[]> {
  const result = (await instance.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
