'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { logFunctionAudit } from '../audit-log';

export interface RecentlyViewedStoreStatus {
  storeId: string;
  shopDomain: string;
  storeName: string;
  enabled: boolean;
  updatedAt: Date | null;
}

/** Drives the toggle-table on /f/functions/recently-viewed. */
export async function listRecentlyViewedStatusPerStore(): Promise<RecentlyViewedStoreStatus[]> {
  const rows = await db.execute<{
    id: string; shop_domain: string; name: string;
    enabled: boolean | null; updated_at: Date | null;
  }>(sql`
    SELECT s.id, s.shop_domain, s.name,
           sfs.enabled,
           sfs.updated_at
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id AND sfs.function_key = 'recently-viewed'
     ORDER BY s.name;
  `);
  return rows.rows.map((r) => ({
    storeId: r.id,
    shopDomain: r.shop_domain,
    storeName: r.name,
    enabled: r.enabled ?? false,
    updatedAt: r.updated_at,
  }));
}

export async function setRecentlyViewedEnabled(
  storeId: string, enabled: boolean,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('forbidden');
  }
  const [prev] = await db
    .select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, storeId),
      eq(schema.storeFunctionSettings.functionKey, 'recently-viewed'),
    ));
  await db
    .insert(schema.storeFunctionSettings)
    .values({
      storeId,
      functionKey: 'recently-viewed',
      enabled,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.storeFunctionSettings.storeId, schema.storeFunctionSettings.functionKey],
      set: { enabled, updatedBy: session.user.id, updatedAt: new Date() },
    });
  await logFunctionAudit({
    functionKey: 'recently-viewed',
    storeId,
    actorUserId: session.user.id,
    action: 'toggle',
    payload: { from: prev?.enabled ?? false, to: enabled },
  });
  revalidatePath('/f/functions/recently-viewed');
  revalidatePath('/f/functions');
}
