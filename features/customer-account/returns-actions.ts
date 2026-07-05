'use server';

/**
 * Mutating server action for the returns queue. File-level `'use server'` makes
 * every export a Server Action, so a client component can import it directly
 * without pulling `@/db/client` into the browser bundle (Next 16 forbids inline
 * per-function `'use server'` inside client-imported modules). Read query lives
 * in `returns-admin.ts`; client-safe constants/types in `returns-shared.ts`.
 */

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { RETURN_STATUSES, type ReturnStatus } from './returns-shared';

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

/** Duyệt trạng thái + ghi chú nội bộ cho một yêu cầu đổi/trả. */
export async function updateReturnStatus(
  id: string,
  status: string,
  adminNote: string,
): Promise<{ ok: boolean; error?: string }> {
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
