'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { syncLarkPacks, type LarkSyncSummary } from './sync';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('Forbidden');
  return session.user.id;
}

export async function syncLarkPacksAction(): Promise<LarkSyncSummary> {
  await requireUser();
  const summary = await syncLarkPacks();
  revalidatePath('/f/shipping-reconcile');
  return summary;
}
