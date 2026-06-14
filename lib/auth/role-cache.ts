import type { PermissionKey } from './permissions';

/**
 * Pure, DB-free role→permission cache. Kept separate from `access.ts` (which
 * imports the pg-backed `db/client`) so the client bundle can reach the read
 * helpers via `lib/nav → rbac` WITHOUT dragging the Postgres driver — and its
 * Node built-ins (dns/fs) — into the browser build.
 *
 * The cache is a process-level Map warmed by `access.refreshRoleCache` (server)
 * and read synchronously here. 30s TTL is enforced by the writer.
 */
let cache: Map<string, Set<PermissionKey>> | null = null;
let cacheAt = 0;

/** Replace the cache (called by the server-side DB refresh). */
export function setRoleCache(next: Map<string, Set<PermissionKey>>): void {
  cache = next;
  cacheAt = Date.now();
}

export function isCacheWarm(): boolean {
  return cache !== null;
}

/** Milliseconds since the cache was last set; Infinity when never warmed. */
export function roleCacheAgeMs(): number {
  return cache === null ? Infinity : Date.now() - cacheAt;
}

/** Permission key Set for a role key (cache must be warm — call ensureRoleCache first). */
export function permissionsForRoleKey(roleKey: string): Set<PermissionKey> {
  return cache?.get(roleKey) ?? new Set();
}

/** Prime the cache directly (no DB) — for tests / deterministic seeding. */
export function primeRoleCache(entries: Record<string, Iterable<PermissionKey>>): void {
  const next = new Map<string, Set<PermissionKey>>();
  for (const [roleKey, keys] of Object.entries(entries)) next.set(roleKey, new Set(keys));
  setRoleCache(next);
}

export function can(perms: Set<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}
