'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { logFunctionAudit } from '../audit-log';

const FUNCTION_KEY = 'style-quiz';

export interface StyleQuizStoreStatus {
  storeId: string;
  shopDomain: string;
  storeName: string;
  enabled: boolean;
  /** Customer Account bật cho store chưa — quiz ship trong extension CA nên cần bật CA. */
  customerAccountEnabled: boolean;
  updatedAt: Date | null;
}

/** Mọi store + trạng thái bật Style Quiz + có bật Customer Account không. */
export async function listStyleQuizStatusPerStore(): Promise<StyleQuizStoreStatus[]> {
  const rows = await db.execute<{
    id: string; shop_domain: string; name: string;
    enabled: boolean | null; ca_enabled: boolean | null; updated_at: Date | null;
  }>(sql`
    SELECT s.id, s.shop_domain, s.name,
           sfs.enabled, sfs.updated_at,
           cac.enabled AS ca_enabled
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id AND sfs.function_key = ${FUNCTION_KEY}
      LEFT JOIN customer_account_configs cac
        ON cac.store_id = s.id
     ORDER BY s.name;
  `);
  return rows.rows.map((r) => ({
    storeId: r.id,
    shopDomain: r.shop_domain,
    storeName: r.name,
    enabled: r.enabled ?? false,
    customerAccountEnabled: r.ca_enabled ?? false,
    updatedAt: r.updated_at,
  }));
}

export async function setStyleQuizEnabled(storeId: string, enabled: boolean): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) throw new Error('forbidden');

  const [prev] = await db
    .select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, storeId),
      eq(schema.storeFunctionSettings.functionKey, FUNCTION_KEY),
    ));
  await db
    .insert(schema.storeFunctionSettings)
    .values({ storeId, functionKey: FUNCTION_KEY, enabled, updatedBy: session.user.id })
    .onConflictDoUpdate({
      target: [schema.storeFunctionSettings.storeId, schema.storeFunctionSettings.functionKey],
      set: { enabled, updatedBy: session.user.id, updatedAt: new Date() },
    });
  await logFunctionAudit({
    functionKey: FUNCTION_KEY, storeId, actorUserId: session.user.id,
    action: 'toggle', payload: { from: prev?.enabled ?? false, to: enabled },
  });
  revalidatePath('/f/functions/style-quiz');
  revalidatePath('/f/functions');
}
