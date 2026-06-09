import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ensureRoleCache } from './access';

/** Returns the user's role KEY (e.g. 'admin', 'logistics'). Defaults to 'viewer'. */
export async function getRole(userId: string): Promise<string> {
  const [row] = await db.select({
    legacy: schema.roles.role,
    key: schema.appRoles.key,
  })
    .from(schema.roles)
    .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
    .where(eq(schema.roles.userId, userId))
    .limit(1);
  await ensureRoleCache();
  return row?.key ?? row?.legacy ?? 'viewer';
}
