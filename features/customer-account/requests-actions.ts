'use server';

/**
 * Mutating server actions for the order-journey requests queue (cancel/claim).
 * File-level `'use server'` makes every export a Server Action, so a client
 * component can import it directly without pulling `@/db/client` into the
 * browser bundle (Next 16 forbids inline per-function `'use server'` inside
 * client-imported modules). Read query lives in `requests-admin.ts`;
 * client-safe constants/types in `requests-shared.ts`.
 */

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { canTransition, type RequestKind, type RequestStatus } from './request-status';

/**
 * Gate a mutating Customer Account admin action: server actions are
 * independently callable, so they verify the caller can manage functions
 * rather than trust the calling page.
 */
async function requireManageFunctions(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Not authenticated.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('You do not have permission to manage functions.');
  }
  return session.user.id;
}

async function loadRequestState(id: string): Promise<{ kind: RequestKind; status: RequestStatus } | null> {
  const [row] = await db.select({
    kind: schema.customerOrderRequests.kind,
    status: schema.customerOrderRequests.status,
  }).from(schema.customerOrderRequests)
    .where(eq(schema.customerOrderRequests.id, id)).limit(1);
  if (!row) return null;
  return { kind: row.kind as RequestKind, status: row.status as RequestStatus };
}

function revalidate(): void {
  revalidatePath('/f/customer-account/requests');
}

/** Duyệt khiếu nại: xác định lỗi do ai (customer/mean), chọn hub nhận hàng trả, ghi chú nội bộ. */
export async function approveClaim(
  id: string, fault: 'customer' | 'mean', returnHubId: string, note: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (fault !== 'customer' && fault !== 'mean') return { ok: false, error: 'Fault không hợp lệ' };
    if (!returnHubId.trim()) return { ok: false, error: 'Cần chọn kho nhận hàng' };

    const current = await loadRequestState(id);
    if (!current) return { ok: false, error: 'Không tìm thấy yêu cầu' };
    if (current.kind !== 'claim') return { ok: false, error: 'Chỉ áp dụng cho khiếu nại' };
    if (!canTransition(current.kind, current.status, 'approved')) {
      return { ok: false, error: 'Không thể duyệt ở trạng thái hiện tại' };
    }

    const now = new Date();
    await db.update(schema.customerOrderRequests).set({
      status: 'approved',
      fault,
      returnHubId,
      returnShippingPayer: fault === 'mean' ? 'mean' : 'customer',
      adminNote: note.trim() || null,
      approvedAt: now,
      reviewedAt: now,
      updatedAt: now,
    }).where(eq(schema.customerOrderRequests.id, id));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Từ chối một yêu cầu khiếu nại — bắt buộc nêu lý do. */
export async function rejectRequest(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const cleanReason = reason.trim();
    if (!cleanReason) return { ok: false, error: 'Cần nêu lý do từ chối' };

    const current = await loadRequestState(id);
    if (!current) return { ok: false, error: 'Không tìm thấy yêu cầu' };
    if (current.kind !== 'claim') return { ok: false, error: 'Chỉ áp dụng cho khiếu nại' };
    if (!canTransition(current.kind, current.status, 'rejected')) {
      return { ok: false, error: 'Không thể từ chối ở trạng thái hiện tại' };
    }

    await db.update(schema.customerOrderRequests).set({
      status: 'rejected',
      rejectedReason: cleanReason,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.customerOrderRequests.id, id));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Đánh dấu đã nhận được hàng trả về (kho đã nhận kiện hàng khiếu nại). */
export async function markReceived(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const current = await loadRequestState(id);
    if (!current) return { ok: false, error: 'Không tìm thấy yêu cầu' };
    if (current.kind !== 'claim') return { ok: false, error: 'Chỉ áp dụng cho khiếu nại' };
    if (!canTransition(current.kind, current.status, 'received')) {
      return { ok: false, error: 'Không thể đánh dấu đã nhận ở trạng thái hiện tại' };
    }

    await db.update(schema.customerOrderRequests).set({
      status: 'received',
      receivedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.customerOrderRequests.id, id));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ghi kết quả QC hàng trả: pass → vào hàng chờ refund; fail → từ chối (bắt buộc ghi chú). */
export async function recordQc(
  id: string, pass: boolean, note: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const cleanNote = note.trim();
    if (!pass && !cleanNote) return { ok: false, error: 'Cần ghi chú lý do khi QC fail' };

    const current = await loadRequestState(id);
    if (!current) return { ok: false, error: 'Không tìm thấy yêu cầu' };
    if (current.kind !== 'claim') return { ok: false, error: 'Chỉ áp dụng cho khiếu nại' };

    const nextStatus: RequestStatus = pass ? 'refund_pending' : 'rejected';
    if (!canTransition(current.kind, current.status, nextStatus)) {
      return { ok: false, error: 'Không thể ghi QC ở trạng thái hiện tại' };
    }

    await db.update(schema.customerOrderRequests).set({
      status: nextStatus,
      ...(pass ? {} : { rejectedReason: cleanNote }),
      qcAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.customerOrderRequests.id, id));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Đánh dấu đã hoàn tiền thủ công trong Shopify (mọi kind: cancel hoặc claim). */
export async function markRefunded(id: string): Promise<{ ok: boolean; error?: string }> {
  let userId: string;
  try {
    userId = await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const current = await loadRequestState(id);
    if (!current) return { ok: false, error: 'Không tìm thấy yêu cầu' };
    if (!canTransition(current.kind, current.status, 'refunded')) {
      return { ok: false, error: 'Không thể đánh dấu đã refund ở trạng thái hiện tại' };
    }

    await db.update(schema.customerOrderRequests).set({
      status: 'refunded',
      refundedAt: new Date(),
      refundedMarkedBy: userId,
      updatedAt: new Date(),
    }).where(eq(schema.customerOrderRequests.id, id));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
