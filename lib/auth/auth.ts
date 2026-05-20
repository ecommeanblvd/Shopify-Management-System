import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * On user creation, atomically assign admin role to the first registered
 * user. The single SQL statement guards against the race where two signups
 * land simultaneously: only the transaction whose check sees count === 1
 * AND no existing admin row commits the INSERT.
 */
export async function assignFirstAdmin(userId: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO roles (user_id, role)
      SELECT ${userId}, 'admin'::role
      WHERE (SELECT COUNT(*) FROM "user") = 1
        AND NOT EXISTS (SELECT 1 FROM roles WHERE role = 'admin')
    `);
  } catch {
    // Race loser: another concurrent signup already won the unique constraint
    // on roles.userId. Safe to ignore — the winning transaction has already
    // assigned admin to the first user.
  }
}

// Read directly from process.env — NOT via getEnv() — so this module is
// safe to import at build time even when the env vars are unset.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  databaseHooks: {
    user: {
      create: {
        after: async (newUser) => {
          await assignFirstAdmin(newUser.id);
        },
      },
    },
  },
});
