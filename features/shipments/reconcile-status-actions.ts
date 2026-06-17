'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { isCarrierErrorKind } from './carrier-error-kinds';

const ROUTE = '/f/shipping-reconcile';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    throw new Error('Forbidden');
  }
  return session.user.id;
}

export interface SetReconcileStatusInput {
  shipmentId: string;
  status: 'reconciled' | 'ignored';
  note?: string | null;
  /** Current billed total, snapshotted for change detection. */
  billedTotal: number;
}

export async function setReconcileStatus(input: SetReconcileStatusInput): Promise<void> {
  const userId = await requireUser();
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: input.status,
      note: input.note?.trim() || null,
      billedTotalAtReview: input.billedTotal.toString(),
      carrierErrorKind: null,
      deltaVndAtReview: null,
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: input.status,
        note: input.note?.trim() || null,
        billedTotalAtReview: input.billedTotal.toString(),
        carrierErrorKind: null,
        deltaVndAtReview: null,
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

export interface ApproveCarrierErrorInput {
  shipmentId: string;
  kind: string;
  note: string;
  billedTotal: number;
  deltaVnd: number;
}

/** Logistics duyệt: khoản này lệch THẬT do carrier tính sai. Trạng thái cuối
 *  (đơn rời pending). Loại lỗi + lý do bắt buộc; snapshot delta để report. */
export async function approveCarrierError(input: ApproveCarrierErrorInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do lỗi carrier');
  if (!isCarrierErrorKind(input.kind)) throw new Error('Loại lỗi không hợp lệ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: 'carrier_error',
      note,
      carrierErrorKind: input.kind,
      billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'carrier_error',
        note,
        carrierErrorKind: input.kind,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

export interface MarkInternalErrorInput {
  shipmentId: string;
  note: string;
  billedTotal: number;
  deltaVnd: number;
}

/** Lỗi nội bộ: lệch do MÌNH nhập sai dim/kg (carrier cân lại). KHÔNG đòi carrier;
 *  để sửa data nội bộ. Lý do bắt buộc; snapshot delta để tổng kết. */
export async function markInternalError(input: MarkInternalErrorInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do lỗi nội bộ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: 'internal_error',
      note,
      billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'internal_error',
        note,
        carrierErrorKind: null,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

export interface DisputeCarrierInput {
  shipmentId: string;
  kind: string;
  note: string;
  billedTotal: number;
  deltaVnd: number;
}

/** Mở đòi NCC: đơn sang 'disputing', chốt loại lỗi + số lệch gốc đang đòi. */
export async function disputeWithCarrier(input: DisputeCarrierInput): Promise<void> {
  const userId = await requireUser();
  const note = input.note.trim();
  if (!note) throw new Error('Cần ghi rõ lý do đòi NCC');
  if (!isCarrierErrorKind(input.kind)) throw new Error('Loại lỗi không hợp lệ');
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: 'disputing',
      note,
      carrierErrorKind: input.kind,
      billedTotalAtReview: input.billedTotal.toString(),
      deltaVndAtReview: input.deltaVnd.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: 'disputing',
        note,
        carrierErrorKind: input.kind,
        billedTotalAtReview: input.billedTotal.toString(),
        deltaVndAtReview: input.deltaVnd.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

/** Remove the status row → shipment returns to "pending". */
export async function clearReconcileStatus(shipmentId: string): Promise<void> {
  await requireUser();
  await db
    .delete(schema.shipmentReconcileStatus)
    .where(eq(schema.shipmentReconcileStatus.shipmentId, shipmentId));
  revalidatePath(ROUTE);
}
