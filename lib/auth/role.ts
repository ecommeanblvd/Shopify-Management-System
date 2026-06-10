import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ensureRoleCache } from './access';

export interface RoleInfo {
  /** Whether the user has a roles row at all — gates the "no role" screen. */
  exists: boolean;
  /** Resolved role KEY (e.g. 'admin', 'logistics'). 'viewer' fallback. */
  role: string;
}

// Process-level per-user cache, same 30s TTL convention as the
// permission cache in access.ts. Saves the layout + every page from
// re-running the roles join on each navigation.
const roleInfoCache = new Map<string, { info: RoleInfo; at: number }>();
const TTL_MS = 30_000;

/** Drop a user's cached role (call after role edits) — or all when omitted. */
export function invalidateRoleInfo(userId?: string): void {
  if (userId) roleInfoCache.delete(userId);
  else roleInfoCache.clear();
}

/**
 * One DB round trip resolving both "does the user have a role row" and
 * the role key. Cached 30s per user. Also warms the permission cache
 * that the sync `hasPermission()` shim reads.
 */
export async function getRoleInfo(userId: string): Promise<RoleInfo> {
  const hit = roleInfoCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    await ensureRoleCache();
    return hit.info;
  }
  const [row] = await db.select({
    legacy: schema.roles.role,
    key: schema.appRoles.key,
  })
    .from(schema.roles)
    .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
    .where(eq(schema.roles.userId, userId))
    .limit(1);
  await ensureRoleCache();
  const info: RoleInfo = {
    exists: !!row,
    role: row?.key ?? row?.legacy ?? 'viewer',
  };
  roleInfoCache.set(userId, { info, at: Date.now() });
  return info;
}

/** Returns the user's role KEY (e.g. 'admin', 'logistics'). Defaults to 'viewer'. */
export async function getRole(userId: string): Promise<string> {
  return (await getRoleInfo(userId)).role;
}
