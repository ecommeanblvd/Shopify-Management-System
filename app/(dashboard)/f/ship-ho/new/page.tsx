import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { listAccounts } from '@/features/carrier-rates/actions';
import { NewOrderForm } from './NewOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewShipHoOrderPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const [partners, accounts] = await Promise.all([listShipHoPartners(), listAccounts()]);
  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Tạo đơn ship hộ</h1>
      <NewOrderForm
        partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, carrierKey: a.carrierKey ?? '' }))}
        userEmail={session.user.email}
      />
    </div>
  );
}
