'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

async function requireWarehouse(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_warehouse')) throw new Error('Forbidden');
  return session.user.id;
}

export interface WarehouseItemInput {
  sku: string; productTitle?: string | null; variantTitle?: string | null;
  qtyOnHand: number; shelf?: string | null; floor?: string | null; bin?: string | null; note?: string | null;
  warehouseCode?: string;
}

export async function upsertWarehouseItem(input: WarehouseItemInput): Promise<void> {
  const userId = await requireWarehouse();
  await db.insert(schema.warehouseInventory)
    .values({ ...input, sku: input.sku.trim(), warehouseCode: input.warehouseCode ?? 'HN', updatedBy: userId })
    .onConflictDoUpdate({
      target: [schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode],
      set: {
        productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
        qtyOnHand: input.qtyOnHand, shelf: input.shelf ?? null, floor: input.floor ?? null,
        bin: input.bin ?? null, note: input.note ?? null, updatedBy: userId, updatedAt: sql`now()`,
      },
    });
  revalidatePath('/f/fulfillment/warehouse');
}

export async function adjustStock(sku: string, delta: number): Promise<void> {
  const userId = await requireWarehouse();
  // TODO(T7): rewrite through ledger
  await db.update(schema.warehouseInventory)
    .set({ qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${delta}`, updatedBy: userId, updatedAt: sql`now()` })
    .where(eq(schema.warehouseInventory.sku, sku.trim()));
  revalidatePath('/f/fulfillment/warehouse');
}
