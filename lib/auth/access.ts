import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { PermissionKey } from './permissions';
import { setRoleCache, isCacheWarm, roleCacheAgeMs, permissionsForRoleKey } from './role-cache';

// Pure cache read helpers live in `./role-cache` (DB-free) so the client bundle
// can reach them via lib/nav → rbac without importing the pg driver. This file
// holds only the server-side (DB-backed) cache warming + per-user resolution.
// Re-exported here for backward-compatible import paths.
export { permissionsForRoleKey, primeRoleCache, can } from './role-cache';

const TTL_MS = 30_000;

export async function refreshRoleCache(): Promise<void> {
  const rows = await db.select({
    key: schema.appRoles.key, permissionKey: schema.rolePermissions.permissionKey,
  }).from(schema.appRoles)
    .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.appRoles.id));
  const next = new Map<string, Set<PermissionKey>>();
  for (const r of rows) {
    if (!next.has(r.key)) next.set(r.key, new Set());
    if (r.permissionKey) next.get(r.key)!.add(r.permissionKey);
  }
  setRoleCache(next);
}

export async function ensureRoleCache(): Promise<void> {
  if (!isCacheWarm() || roleCacheAgeMs() > TTL_MS) await refreshRoleCache();
}

/** Resolve the permission Set for a user (warms cache). */
export async function getUserPermissions(userId: string): Promise<Set<PermissionKey>> {
  const { getRole } = await import('./role');
  const roleKey = await getRole(userId); // warms cache
  return permissionsForRoleKey(roleKey);
}
