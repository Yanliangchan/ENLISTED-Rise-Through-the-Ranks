import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail fast and loud — every route depends on this, and a silent undefined
  // connection string produces a confusing "ECONNREFUSED 127.0.0.1:5432"
  // instead of pointing at the real problem.
  throw new Error(
    "DATABASE_URL is not set. Locally, copy .env.example to .env; on Railway, attach a Postgres plugin and " +
      "reference its DATABASE_URL variable on this service."
  );
}

// Railway's managed Postgres sits behind a proxy with a self-signed cert;
// localhost (dev) has no TLS at all. Detect which we're talking to instead of
// hardcoding one or the other.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

pool.on("error", (err) => {
  // A background idle-client error must not crash the process — log and move on.
  console.error("[db] idle client error", err);
});

export type QueryParams = ReadonlyArray<unknown>;

/** Thin query helper — every route goes through this so pooling/logging stays centralised. */
export async function query<T = unknown>(text: string, params: QueryParams = []): Promise<T[]> {
  const result = await pool.query(text, params as unknown[]);
  return result.rows as T[];
}

/** Single-row convenience wrapper — returns null instead of undefined when nothing matched. */
export async function queryOne<T = unknown>(text: string, params: QueryParams = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a callback inside a transaction; commits on success, rolls back and rethrows on error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
