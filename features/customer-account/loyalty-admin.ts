import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';

export interface AdminLoyaltyRow {
  id: string;
  storeId: string;
  storeName: string;
  shopifyCustomerId: string;
  tier: string;
  note: string | null;
  updatedAt: Date;
}

/**
 * Gate a mutating Customer Account admin action: server actions are
 * independently callable, so they verify the caller can manage functions
 * rather than trust the calling page.
 */
async function requireManageFunctions(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Not authenticated.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('You do not have permission to manage functions.');
  }
}

/** Đọc bảng tier loyalty cho admin: join tên store, cập nhật gần nhất trước. */
export async function listLoyalty(storeId?: string): Promise<AdminLoyaltyRow[]> {
  return db.select({
    id: schema.customerLoyalty.id,
    storeId: schema.customerLoyalty.storeId,
    storeName: schema.stores.name,
    shopifyCustomerId: schema.customerLoyalty.shopifyCustomerId,
    tier: schema.customerLoyalty.tier,
    note: schema.customerLoyalty.note,
    updatedAt: schema.customerLoyalty.updatedAt,
  }).from(schema.customerLoyalty)
    .innerJoin(schema.stores, eq(schema.customerLoyalty.storeId, schema.stores.id))
    .where(storeId ? eq(schema.customerLoyalty.storeId, storeId) : undefined)
    .orderBy(desc(schema.customerLoyalty.updatedAt));
}

/** Thêm/sửa tier loyalty cho một khách (upsert theo store + customerId). */
export async function upsertLoyalty(
  storeId: string,
  shopifyCustomerId: string,
  tier: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  'use server';
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (!storeId) return { ok: false, error: 'Thiếu store' };
    const cleanTier = tier.trim();
    if (!cleanTier) return { ok: false, error: 'Tier không được để trống' };
    const cleanCustomerId = shopifyCustomerId.trim();
    if (!/^\d+$/.test(cleanCustomerId)) {
      return { ok: false, error: 'shopifyCustomerId phải là chuỗi số' };
    }
    const cleanNote = note.trim() || null;
    await db.insert(schema.customerLoyalty)
      .values({ storeId, shopifyCustomerId: cleanCustomerId, tier: cleanTier, note: cleanNote })
      .onConflictDoUpdate({
        target: [schema.customerLoyalty.storeId, schema.customerLoyalty.shopifyCustomerId],
        set: { tier: cleanTier, note: cleanNote, updatedAt: new Date() },
      });
    revalidatePath('/f/customer-account/loyalty');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Xoá một dòng tier loyalty theo id. */
export async function deleteLoyalty(id: string): Promise<{ ok: boolean; error?: string }> {
  'use server';
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await db.delete(schema.customerLoyalty).where(eq(schema.customerLoyalty.id, id));
    revalidatePath('/f/customer-account/loyalty');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
