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
