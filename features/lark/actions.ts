'use server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { syncLarkPacks } from './sync';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('Forbidden');
  return session.user.id;
}

export interface SyncTriggerResult { started: boolean; alreadyRunning: boolean }

/** Cờ chống chạy chồng (1 instance Railway). Sync nặng vài nghìn dòng. */
let running = false;

/**
 * Kích hoạt sync Lark Ở NỀN rồi trả về NGAY — sync nặng (vài nghìn update)
 * không hợp với 1 request đồng bộ (proxy/Next cắt response → "unexpected
 * response"). Kết quả + lỗi được sync.ts ghi vào lark_sync_runs; banner đọc
 * bản ghi mới nhất để hiển thị.
 */
export async function syncLarkPacksAction(): Promise<SyncTriggerResult> {
  await requireUser();
  if (running) return { started: false, alreadyRunning: true };
  running = true;
  void syncLarkPacks()
    .catch((e) => console.error('[lark] background sync failed', e))
    .finally(() => { running = false; });
  return { started: true, alreadyRunning: false };
}
