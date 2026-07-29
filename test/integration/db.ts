import { Client } from "pg";

/**
 * Harness for exercising RLS against the real database.
 *
 * Everything runs inside one transaction that is always rolled back, so these
 * tests can create users, submissions, and audit rows on the live project
 * without leaving anything behind — which matters because the audit trail is
 * deliberately append-only and submissions cannot be deleted.
 */
export async function connect(): Promise<Client> {
  const url = process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING is missing — run `vercel env pull` first."
    );
  }
  // `sslmode` in the connection string wins over the `ssl` option below, so it
  // has to come off before the override can take effect.
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");

  const client = new Client({
    connectionString: parsed.toString(),
    // Supabase's direct connection presents a self-signed chain, and pg 8.22
    // started treating `sslmode=require` as `verify-full`. The connection is
    // still encrypted; only chain verification is relaxed.
    //
    // This is a test harness reaching a development project from a developer
    // machine. Application code never uses this path — it talks to Supabase
    // over HTTPS via @supabase/supabase-js — so nothing in production
    // inherits this setting.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

/** Impersonate an authenticated Supabase user for subsequent statements. */
export async function actAs(client: Client, userId: string): Promise<void> {
  await client.query("reset role");
  await client.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: "authenticated" })]
  );
  await client.query("set local role authenticated");
}

/** Drop back to the table owner, which bypasses RLS. */
export async function actAsOwner(client: Client): Promise<void> {
  await client.query("reset role");
  await client.query(`select set_config('request.jwt.claims', '', true)`);
}

/**
 * Runs `fn` and reports whether Postgres rejected it.
 *
 * RLS denials surface two different ways: an explicit error for INSERT/UPDATE
 * that trips a `with check` clause, and a silent zero-row result when a
 * `using` clause filters the target out. Both count as "denied", and a test
 * that only looked for a thrown error would pass while the data leaked.
 */
export async function denied(
  client: Client,
  // Accepts any promise, not just a query result: some call sites go through a
  // helper that returns a plain id.
  fn: () => Promise<unknown>
): Promise<{ ok: true; reason: string } | { ok: false; rowCount: number }> {
  // Its own savepoint: a failed statement puts the whole transaction into an
  // aborted state where every later command errors with "current transaction
  // is aborted". Without this, the first expected failure would cascade into
  // spurious failures for the rest of the test.
  await client.query("savepoint denied_sp");
  try {
    const res = await fn();
    await client.query("release savepoint denied_sp");

    // A query result that touched zero rows counts as denied; anything else
    // that returned successfully counts as allowed.
    const rowCount =
      res && typeof res === "object" && "rowCount" in res
        ? ((res as { rowCount: number | null }).rowCount ?? 0)
        : 1;

    return rowCount === 0
      ? { ok: true, reason: "no rows affected" }
      : { ok: false, rowCount };
  } catch (e) {
    await client.query("rollback to savepoint denied_sp");
    return { ok: true, reason: (e as Error).message };
  }
}

/** A savepoint-scoped block, so one failed statement cannot poison the rest. */
export async function scoped<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("savepoint sp");
  try {
    return await fn();
  } finally {
    await client.query("rollback to savepoint sp");
  }
}

/**
 * Deletes committed test data, including the append-only audit rows.
 *
 * Needed only by the concurrency test: proving that the second of two racing
 * approvals is refused requires the first one to actually commit, so that test
 * cannot hide inside a rolled-back transaction like the others.
 *
 * Bypassing the guard trigger is exactly the thing the guard exists to
 * prevent, which is why it happens here — in teardown, restored immediately —
 * and nowhere in the application.
 *
 * `session_replication_role` rather than `alter table … disable trigger`: the
 * DDL form needs an ACCESS EXCLUSIVE lock on submission_actions, which blocks
 * behind the open transactions the other test files hold, and deadlocks the
 * run outright when node executes test files in parallel. This setting is
 * scoped to this connection and takes no lock at all.
 */
export async function purgeUsers(client: Client, userIds: string[]): Promise<void> {
  await client.query("reset role");
  await client.query("set session_replication_role = replica");
  try {
    await client.query(
      `delete from public.submission_actions
       where submission_id in (select id from public.submissions where submitted_by = any($1))
          or actor_id = any($1)`,
      [userIds]
    );
    await client.query(`delete from public.submissions where submitted_by = any($1)`, [
      userIds,
    ]);
    await client.query(`delete from public.facilities where created_by = any($1)`, [
      userIds,
    ]);
    await client.query(`delete from auth.users where id = any($1)`, [userIds]);
  } finally {
    await client.query("set session_replication_role = origin");
  }
}
