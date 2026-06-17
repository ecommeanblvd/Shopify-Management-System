'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listOverridesForStore } from './actions';
import { planSeedRows, mergeSystemShippingRows, type SystemShippingRow } from './system-shipping-domain';
import type { ShippingTree } from '@/features/settings-sync/domain/shipping';

async function requireApply(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'apply_markets')) throw new Error('forbidden');
  return session.user.id;
}

/** Seed bảng hệ thống từ override của store nguồn (cici). Idempotent: upsert theo
 *  market_handle, tăng version. Trả số market seed. */
export async function seedSystemShippingFromStore(sourceStoreId: string): Promise<number> {
  const userId = await requireApply();
  const rows = planSeedRows(await listOverridesForStore(sourceStoreId));
  for (const r of rows) {
    const [existing] = await db.select().from(schema.manualShippingConfig)
      .where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle)).limit(1);
    if (existing) {
      await db.update(schema.manualShippingConfig)
        .set({ shipping: r.shipping, version: existing.version + 1, updatedBy: userId, updatedAt: new Date() })
        .where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle));
    } else {
      await db.insert(schema.manualShippingConfig).values({ marketHandle: r.marketHandle, shipping: r.shipping, version: 1, updatedBy: userId });
    }
  }
  return rows.length;
}

export async function listSystemShipping(): Promise<SystemShippingRow[]> {
  const rows = await db.select().from(schema.manualShippingConfig);
  return rows.map((r) => ({ marketHandle: r.marketHandle, shipping: r.shipping as SystemShippingRow['shipping'] }));
}

export async function buildSystemShippingTree(): Promise<ShippingTree> {
  return mergeSystemShippingRows(await listSystemShipping());
}
