'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';
import { sanitizeConfig } from './config-schema';
import { isPngBytes } from './png';

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

const ASSET_KINDS = ['logo', 'hero', 'icon'] as const;

export async function saveCustomerAccountConfig(
  storeId: string,
  enabled: boolean,
  rawConfig: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const config = sanitizeConfig(rawConfig);
    await db.insert(schema.customerAccountConfigs)
      .values({ storeId, enabled, config })
      .onConflictDoUpdate({
        target: schema.customerAccountConfigs.storeId,
        set: { enabled, config, updatedAt: new Date() },
      });
    revalidatePath('/f/customer-account');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadCustomerAccountAsset(
  storeId: string,
  kind: string,
  formData: FormData,
): Promise<{ ok: boolean; assetId?: string; error?: string }> {
  try {
    await requireManageFunctions();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (!ASSET_KINDS.includes(kind as (typeof ASSET_KINDS)[number])) {
      return { ok: false, error: 'Loại ảnh không hợp lệ' };
    }
    const file = formData.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'Thiếu file' };
    if (file.type !== 'image/png') return { ok: false, error: 'Chỉ nhận PNG' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPngBytes(bytes)) return { ok: false, error: 'Chỉ nhận PNG' };

    const fileKey = `customer-account/${storeId}/${crypto.randomUUID()}.png`;
    await putObject(fileKey, bytes, 'image/png');
    const [row] = await db.insert(schema.customerAccountAssets)
      .values({ storeId, kind, filename: file.name || 'asset.png', fileKey, contentType: 'image/png' })
      .returning({ id: schema.customerAccountAssets.id });
    revalidatePath('/f/customer-account');
    return { ok: true, assetId: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
