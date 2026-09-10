'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { layLyDo } from './ly-do-cham';

/** Gán / bỏ lý do giao chậm cho một kiện. Ops có quyền đối soát phí ship là gán được. */
export async function datLyDoCham(input: { shipmentId: string; lyDo: string | null; ghiChu?: string | null }): Promise<{ ok: true }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) throw new Error('Không có quyền gán lý do giao chậm');
  if (input.lyDo != null && !layLyDo(input.lyDo)) throw new Error('Lý do không hợp lệ');

  await db.update(schema.shipments).set({
    lyDoCham: input.lyDo,
    lyDoChamGhiChu: input.lyDo == null ? null : (input.ghiChu?.trim() || null),
    lyDoChamBy: input.lyDo == null ? null : session.user.id,
    lyDoChamAt: input.lyDo == null ? null : new Date(),
  }).where(eq(schema.shipments.id, input.shipmentId));

  revalidatePath('/f/ship-report');
  revalidatePath('/f/kpi-logistics');
  return { ok: true };
}
