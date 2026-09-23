import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { chiTietDon } from '@/features/kol/queries';
import { ChiTietDon } from '@/components/kol/ChiTietDon';

export const dynamic = 'force-dynamic';

export default async function ChiTietKolPage({ params }: { params: Promise<{ ma: string }> }) {
  const { ma } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_kol');

  const ket = await chiTietDon(ma);
  if (!ket) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Không tìm thấy đơn {ma}</h1>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 max-w-5xl space-y-6">
      <ChiTietDon don={ket.don} dong={ket.dong} canManage={canManage} />
    </div>
  );
}
