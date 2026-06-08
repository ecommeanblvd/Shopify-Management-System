import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

/**
 * Gate a mutating carrier-rates server action: actions are independently
 * callable, so they must verify the caller can manage rates rather than
 * trust the calling page. Returns the authenticated user id.
 */
export async function requireManageCarrierRates(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Not authenticated.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_carrier_rates')) {
    throw new Error('You do not have permission to manage carrier rates.');
  }
  return session.user.id;
}
