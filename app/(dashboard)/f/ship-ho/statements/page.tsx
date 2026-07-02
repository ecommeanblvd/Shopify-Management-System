import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoStatements, arByPartner, marginByPartner } from '@/features/ship-ho/statement-queries';
import { listShipHoPartners } from '@/features/ship-ho/partners-actions';
import { StatementsManager } from './StatementsManager';

export const dynamic = 'force-dynamic';

export default async function ShipHoStatementsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  const [statements, ar, margin, partners] = await Promise.all([
    listShipHoStatements(), arByPartner(), marginByPartner(), listShipHoPartners(),
  ]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Bảng kê & công nợ ship hộ</h1>
      <StatementsManager
        statements={statements}
        ar={ar}
        margin={margin}
        partners={partners.filter((p) => p.status === 'active').map((p) => ({ slug: p.brandSlug, name: p.displayName ?? p.brandSlug }))}
        canManage={canManage}
      />
    </div>
  );
}
