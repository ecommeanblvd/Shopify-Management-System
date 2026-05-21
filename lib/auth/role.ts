import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Role } from './rbac';

export async function getRole(userId: string): Promise<Role> {
  const [row] = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.userId, userId))
    .limit(1);
  return (row?.role as Role | undefined) ?? 'viewer';
}
