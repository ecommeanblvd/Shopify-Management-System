import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';

/** Trạng thái vòng đời của một yêu cầu đổi/trả. */
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface AdminReturnRow {
  id: string;
  storeName: string;
  orderNumber: string | null;
  shopifyCustomerId: string;
  reason: string;
  note: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
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

/** Đọc queue đổi/trả cho admin: join tên store + số đơn Shopify, mới nhất trước. */
export async function listAdminReturns(
  filter: { storeId?: string; status?: string } = {},
): Promise<AdminReturnRow[]> {
  const conds = [];
  if (filter.storeId) conds.push(eq(schema.customerReturnRequests.storeId, filter.storeId));
  if (filter.status) conds.push(eq(schema.customerReturnRequests.status, filter.status));

  return db.select({
    id: schema.customerReturnRequests.id,
    storeName: schema.stores.name,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    shopifyCustomerId: schema.customerReturnRequests.shopifyCustomerId,
    reason: schema.customerReturnRequests.reason,
    note: schema.customerReturnRequests.note,
    status: schema.customerReturnRequests.status,
    adminNote: schema.customerReturnRequests.adminNote,
    createdAt: schema.customerReturnRequests.createdAt,
  }).from(schema.customerReturnRequests)
    .innerJoin(schema.stores, eq(schema.customerReturnRequests.storeId, schema.stores.id))
    .innerJoin(schema.shopifyOrders, eq(schema.customerReturnRequests.orderId, schema.shopifyOrders.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.customerReturnRequests.createdAt));
}

/** Duyệt trạng thái + ghi chú nội bộ cho một yêu cầu đổi/trả. */
export async function updateReturnStatus(
  id: string,
  status: string,
  adminNote: string,
): Promise<{ ok: boolean; error?: string }> {
  'use server';
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (!RETURN_STATUSES.includes(status as ReturnStatus)) {
      return { ok: false, error: 'Trạng thái không hợp lệ' };
    }
    await db.update(schema.customerReturnRequests)
      .set({ status, adminNote: adminNote.trim() || null, updatedAt: new Date() })
      .where(eq(schema.customerReturnRequests.id, id));
    revalidatePath('/f/customer-account/returns');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
