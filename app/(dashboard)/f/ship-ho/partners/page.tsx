import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners, listBrandsForShipHo } from '@/features/ship-ho/partners-actions';
import { PartnersManager } from './PartnersManager';

export const dynamic = 'force-dynamic';

export default async function ShipHoPartnersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const [partners, brands] = await Promise.all([listShipHoPartners(), listBrandsForShipHo()]);
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đối tác ship hộ</h1>
      <PartnersManager partners={partners} brands={brands} canManage={canManage} />
    </div>
  );
}
