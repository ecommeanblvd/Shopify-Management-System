'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export async function updateSla(key: string, targetHours: number): Promise<{ ok: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) return { ok: false, error: 'Không có quyền' };
  if (!Number.isFinite(targetHours) || targetHours <= 0) return { ok: false, error: 'Giờ không hợp lệ' };
  await db.update(schema.lifecycleSla)
    .set({ targetHours: Math.round(targetHours), updatedAt: new Date() })
    .where(eq(schema.lifecycleSla.key, key));
  revalidatePath('/f/lifecycle/sla');
  return { ok: true };
}
