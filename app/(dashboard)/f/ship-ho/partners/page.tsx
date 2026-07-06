import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoPartners, listBrandsForShipHo } from '@/features/ship-ho/partners-actions';
import { buttonVariants } from '@/components/ui/button';
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
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Đối tác ship hộ</h1>
        {canManage && <Link href="/f/ship-ho/partner-requests" className={buttonVariants({ variant: 'outline' })}>Đăng ký ship hộ</Link>}
      </div>
      <PartnersManager partners={partners} brands={brands} canManage={canManage} />
    </div>
  );
}
