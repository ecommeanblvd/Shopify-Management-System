import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Trim + lowercase an email for consistent comparison and storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse BOOTSTRAP_ADMIN_EMAILS (csv) into a normalized list. Read directly
 *  from process.env so this module is build-safe even when the var is unset. */
export function bootstrapAdminEmails(): string[] {
  const raw = process.env.BOOTSTRAP_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 0);
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().includes(normalizeEmail(email));
}

/** Closed-model gate decision (pure). The caller supplies the DB lookup result. */
export function shouldAllowSignup(args: { email: string; hasPendingInvite: boolean }): boolean {
  return isBootstrapAdmin(args.email) || args.hasPendingInvite;
}

/** Legacy enum values writable to roles.role. */
const LEGACY_ROLE_KEYS = new Set(['admin', 'operator', 'viewer']);

/** Look up an app_role's id by its key (e.g. 'admin'). */
export async function appRoleIdByKey(key: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.appRoles.id })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.key, key))
    .limit(1);
  return row?.id ?? null;
}

/** Assign (or replace) a user's role given an app_role id. Mirrors the legacy
 *  enum sync used by /admin/users.
 *
 *  Caller assumption: invoked on a user's FIRST sign-in (from auth's
 *  user.create.after), so no prior roles row exists and the non-legacy fallback
 *  to 'viewer' is correct. If reused where a row may already exist, replicate
 *  the "preserve existing legacy value" logic from /admin/users setRoleAction. */
export async function assignUserRole(userId: string, appRoleId: string): Promise<void> {
  const [appRole] = await db
    .select()
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, appRoleId))
    .limit(1);
  if (!appRole) return;
  const legacy = LEGACY_ROLE_KEYS.has(appRole.key)
    ? (appRole.key as 'admin' | 'operator' | 'viewer')
    : 'viewer';
  await db
    .insert(schema.roles)
    .values({ userId, roleId: appRole.id, role: legacy })
    .onConflictDoUpdate({
      target: schema.roles.userId,
      set: { roleId: appRole.id, role: legacy },
    });
}

/** The single pending invite for an email, or null. */
export async function findPendingInvite(email: string) {
  const [row] = await db
    .select()
    .from(schema.userInvites)
    .where(and(
      eq(schema.userInvites.email, normalizeEmail(email)),
      eq(schema.userInvites.status, 'pending'),
    ))
    .limit(1);
  return row ?? null;
}

/** Create or re-open a pending invite for an email (idempotent on email). */
export async function createInvite(args: {
  email: string;
  roleId: string | null;
  invitedByUserId: string;
}): Promise<void> {
  const email = normalizeEmail(args.email);
  await db
    .insert(schema.userInvites)
    .values({
      email,
      roleId: args.roleId,
      invitedByUserId: args.invitedByUserId,
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: schema.userInvites.email,
      set: {
        roleId: args.roleId,
        invitedByUserId: args.invitedByUserId,
        status: 'pending',
        createdAt: new Date(),
        acceptedAt: null,
        acceptedUserId: null,
      },
    });
}

/** Pending invites with role + inviter for display. */
export async function listPendingInvites() {
  return db
    .select({
      id: schema.userInvites.id,
      email: schema.userInvites.email,
      roleId: schema.userInvites.roleId,
      roleName: schema.appRoles.name,
      createdAt: schema.userInvites.createdAt,
      invitedByEmail: schema.user.email,
    })
    .from(schema.userInvites)
    .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.userInvites.roleId))
    .leftJoin(schema.user, eq(schema.user.id, schema.userInvites.invitedByUserId))
    .where(eq(schema.userInvites.status, 'pending'))
    .orderBy(schema.userInvites.createdAt);
}

/** Revoke a still-pending invite. No-op if the invite was already accepted or
 *  revoked (guarded so a stray id can't flip an accepted invite). */
export async function revokeInvite(id: string): Promise<void> {
  await db
    .update(schema.userInvites)
    .set({ status: 'revoked' })
    .where(and(
      eq(schema.userInvites.id, id),
      eq(schema.userInvites.status, 'pending'),
    ));
}

/** Mark an email's pending invite accepted and return its roleId (or null). */
export async function acceptInvite(args: { email: string; userId: string }): Promise<string | null> {
  const invite = await findPendingInvite(args.email);
  if (!invite) return null;
  await db
    .update(schema.userInvites)
    .set({ status: 'accepted', acceptedAt: new Date(), acceptedUserId: args.userId })
    .where(eq(schema.userInvites.id, invite.id));
  return invite.roleId ?? null;
}
