import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listRoles() {
  const roles = await db.select().from(schema.appRoles).orderBy(schema.appRoles.name);
  const perms = await db.select().from(schema.rolePermissions);
  const byRole = new Map<string, string[]>();
  for (const p of perms) {
    if (!byRole.has(p.roleId)) byRole.set(p.roleId, []);
    byRole.get(p.roleId)!.push(p.permissionKey);
  }
  return roles.map((r) => ({ ...r, permissionKeys: byRole.get(r.id) ?? [] }));
}

/** User IDs whose currently-assigned role grants `users_roles:edit`
 *  (i.e. can manage users/roles). Source of truth for the anti-lockout invariant. */
export async function userIdsWhoCanManageUsers(): Promise<string[]> {
  const rows = await db.select({ userId: schema.roles.userId })
    .from(schema.roles)
    .innerJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.appRoles.id))
    .where(eq(schema.rolePermissions.permissionKey, 'users_roles:edit'));
  return [...new Set(rows.map((r) => r.userId))];
}

/** Does the app_role with this id grant `users_roles:edit`? */
export async function roleGrantsUserManagement(roleId: string): Promise<boolean> {
  const [row] = await db.select({ k: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .where(and(eq(schema.rolePermissions.roleId, roleId), eq(schema.rolePermissions.permissionKey, 'users_roles:edit')))
    .limit(1);
  return !!row;
}
