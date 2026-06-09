/**
 * Auth cutover reset — clears all identity/auth rows so the system starts on a
 * clean closed-invite model (Google-only). Run this ONCE when switching away
 * from the legacy email/password era, BEFORE the owner's first Google sign-in.
 *
 * Why: the closed-invite gate lives in better-auth's user.create.before hook,
 * which only fires when a NEW user is created. A pre-existing `user` row (from
 * the password era) is matched by email and auto-linked to Google on sign-in,
 * bypassing the invite gate entirely. Removing those legacy rows closes the gap.
 *
 * What it does (in one transaction):
 *   1. Introspects every FK column that references "user".
 *   2. NULLs the nullable attribution columns (created_by/updated_by/...) on
 *      business tables so their rows are preserved (data kept, attribution lost).
 *   3. Deletes roles + user_invites + session + account + verification + user.
 *
 * Business data (orders, stores, wishlists, carrier rates, ...) is preserved —
 * only the "who touched this" attribution on legacy users is cleared.
 *
 * Safety: DRY-RUN by default. It prints what it WOULD do and rolls back.
 * Pass --execute to actually commit.
 *
 *   # preview against Railway
 *   DATABASE_URL='postgres://...' npx tsx scripts/reset-auth.ts
 *   # actually wipe
 *   DATABASE_URL='postgres://...' npx tsx scripts/reset-auth.ts --execute
 */
import { Pool } from 'pg';

const EXECUTE = process.argv.includes('--execute');

// Auth/identity tables to clear outright (order doesn't matter inside the txn
// because we defer constraints). `user` last conceptually.
const AUTH_TABLES = ['session', 'account', 'verification', 'roles', 'user_invites'];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Find every column that is a FK referencing the "user" table.
    const { rows: fkCols } = await client.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
    }>(`
      SELECT tc.table_name, kcu.column_name, c.is_nullable
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      JOIN information_schema.columns c
        ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = kcu.column_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'user'
      ORDER BY tc.table_name, kcu.column_name
    `);

    // Business attribution columns we will NULL (everything except the auth
    // tables we delete wholesale). All must be nullable to be NULLed safely.
    const toNull = fkCols.filter((r) => !AUTH_TABLES.includes(r.table_name));
    const nonNullable = toNull.filter((r) => r.is_nullable === 'NO');
    if (nonNullable.length > 0) {
      throw new Error(
        'Refusing to run: these user-FK columns are NOT NULL and would block ' +
        'user deletion without losing rows:\n' +
        nonNullable.map((r) => `  - ${r.table_name}.${r.column_name}`).join('\n') +
        '\nHandle these manually before resetting.',
      );
    }

    const { rows: before } = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM "user"');
    console.log(`Users currently in DB: ${before[0].n}`);
    console.log(`Business attribution columns to NULL: ${toNull.length}`);
    console.log(`Auth tables to clear: ${AUTH_TABLES.join(', ')}`);
    console.log('');

    await client.query('BEGIN');

    for (const { table_name, column_name } of toNull) {
      const res = await client.query(
        `UPDATE "${table_name}" SET "${column_name}" = NULL WHERE "${column_name}" IS NOT NULL`,
      );
      if (res.rowCount) console.log(`  NULLed ${res.rowCount} row(s) in ${table_name}.${column_name}`);
    }

    for (const t of AUTH_TABLES) {
      const res = await client.query(`DELETE FROM "${t}"`);
      console.log(`  Deleted ${res.rowCount ?? 0} row(s) from ${t}`);
    }
    const delUsers = await client.query('DELETE FROM "user"');
    console.log(`  Deleted ${delUsers.rowCount ?? 0} row(s) from user`);

    if (EXECUTE) {
      await client.query('COMMIT');
      console.log('\n✅ COMMITTED. Auth state is clean. Sign in with a BOOTSTRAP_ADMIN_EMAILS account via Google to re-bootstrap admin.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n🟡 DRY-RUN (rolled back). Re-run with --execute to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`reset-auth: failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
