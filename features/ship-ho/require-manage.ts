import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

/**
 * Gate a mutating ship-ho server action: actions are independently
 * callable, so they must verify the caller can manage ship-ho orders/partners
 * rather than trust the calling page. Returns the authenticated user id.
 */
export async function requireManageShipHo(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Not authenticated.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    throw new Error('You do not have permission to manage ship hộ.');
  }
  return session.user.id;
}
