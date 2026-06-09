import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db/client';
import {
  normalizeEmail,
  isBootstrapAdmin,
  findPendingInvite,
  acceptInvite,
  assignUserRole,
  appRoleIdByKey,
} from './invites';

// Read directly from process.env — NOT via getEnv() — so this module is
// safe to import at build time even when the env vars are unset.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Closed-model gate: only bootstrap admins or pending-invited emails
        // may create an account. Returning false aborts user creation.
        before: async (newUser) => {
          const email = normalizeEmail(newUser.email);
          if (isBootstrapAdmin(email)) return;
          const invite = await findPendingInvite(email);
          if (invite) return;
          return false;
        },
        // On first successful sign-in, assign the role: bootstrap admins get
        // 'admin'; invited users get their invite's role (if any).
        after: async (newUser) => {
          const email = normalizeEmail(newUser.email);
          if (isBootstrapAdmin(email)) {
            const adminRoleId = await appRoleIdByKey('admin');
            if (adminRoleId) await assignUserRole(newUser.id, adminRoleId);
            return;
          }
          const roleId = await acceptInvite({ email, userId: newUser.id });
          if (roleId) await assignUserRole(newUser.id, roleId);
        },
      },
    },
  },
});
