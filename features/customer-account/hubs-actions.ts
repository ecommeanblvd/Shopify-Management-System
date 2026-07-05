'use server';

/**
 * Mutating server actions for return hubs. File-level `'use server'` makes
 * every export a Server Action so a client component can import it directly
 * without pulling `@/db/client` into the browser bundle (Next 16 forbids inline
 * per-function `'use server'` inside client-imported modules). Read query lives
 * in `hubs-admin.ts`; client-safe types in `hubs-shared.ts`.
 */

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import type { HubRow } from './hubs-shared';

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

/** Thêm mới hoặc cập nhật một return hub (upsert theo id nếu có). */
export async function upsertHub(
  input: Omit<HubRow, 'id' | 'active'> & { id?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const label = input.label.trim();
    const recipientName = input.recipientName.trim();
    const addressLine1 = input.addressLine1.trim();
    const city = input.city.trim();
    const country = input.country.trim().toUpperCase();

    if (!label) return { ok: false, error: 'Label không được để trống' };
    if (!recipientName) return { ok: false, error: 'Recipient name không được để trống' };
    if (!addressLine1) return { ok: false, error: 'Address line 1 không được để trống' };
    if (!city) return { ok: false, error: 'City không được để trống' };
    if (!/^[A-Z]{2}$/.test(country)) {
      return { ok: false, error: 'Country phải là mã ISO alpha-2 (vd US, VN)' };
    }

    const values = {
      label,
      recipientName,
      addressLine1,
      addressLine2: input.addressLine2?.trim() || null,
      city,
      state: input.state?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      country,
      phone: input.phone?.trim() || null,
    };

    if (input.id) {
      await db.update(schema.returnHubs).set(values).where(eq(schema.returnHubs.id, input.id));
    } else {
      await db.insert(schema.returnHubs).values(values);
    }
    revalidatePath('/f/customer-account/hubs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bật/tắt trạng thái active của một return hub. */
export async function toggleHub(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await db.update(schema.returnHubs).set({ active }).where(eq(schema.returnHubs.id, id));
    revalidatePath('/f/customer-account/hubs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
