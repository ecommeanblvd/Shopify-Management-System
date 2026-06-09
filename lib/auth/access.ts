import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { PermissionKey } from './permissions';

// Process-level cache of roleKey -> permission keys. Warmed by getRole (async)
// so the sync shim `hasPermission` can read it. 30s TTL picks up role edits.
let cache: Map<string, Set<PermissionKey>> | null = null;
let cacheAt = 0;
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
  cache = next; cacheAt = Date.now();
}

export async function ensureRoleCache(): Promise<void> {
  if (!cache || Date.now() - cacheAt > TTL_MS) await refreshRoleCache();
}

/** Permission key Set for a role key (cache must be warm — call ensureRoleCache first). */
export function permissionsForRoleKey(roleKey: string): Set<PermissionKey> {
  return cache?.get(roleKey) ?? new Set();
}

/** Prime the cache directly (no DB) — for tests / deterministic seeding. */
export function primeRoleCache(entries: Record<string, Iterable<PermissionKey>>): void {
  const next = new Map<string, Set<PermissionKey>>();
  for (const [roleKey, keys] of Object.entries(entries)) next.set(roleKey, new Set(keys));
  cache = next;
  cacheAt = Date.now();
}

/** Resolve the permission Set for a user (warms cache). */
export async function getUserPermissions(userId: string): Promise<Set<PermissionKey>> {
  const { getRole } = await import('./role');
  const roleKey = await getRole(userId); // warms cache
  return permissionsForRoleKey(roleKey);
}

export function can(perms: Set<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}
