'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';

export interface MmpPushInfo { status: 'pending' | 'sent' | 'failed'; attempts: number; lastError: string | null; sentAt: Date | null }

export async function getMmpPushInfo(orderId: string): Promise<MmpPushInfo | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) throw new Error('Forbidden');
  const [r] = await db.select({ status: schema.mmpOrderPushes.status, attempts: schema.mmpOrderPushes.attempts, lastError: schema.mmpOrderPushes.lastError, sentAt: schema.mmpOrderPushes.sentAt })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.orderId, orderId)).limit(1);
  return r ? { status: r.status, attempts: r.attempts, lastError: r.lastError, sentAt: r.sentAt } : null;
}

export async function resendOrderToMmp(orderId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
  const result = await pushOrderToMmp(orderId);
  revalidatePath(`/f/fulfillment/${orderId}`);
  if (!result.ok && !result.skipped) throw new Error(result.error ?? 'Đẩy MMP thất bại');
}
