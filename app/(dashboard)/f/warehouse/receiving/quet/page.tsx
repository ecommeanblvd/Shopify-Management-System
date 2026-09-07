import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listBrandDangCho } from '@/features/receiving/nhan-nhanh-queries';
import { QuetNhanHang } from '@/components/receiving/QuetNhanHang';

export const dynamic = 'force-dynamic';

export default async function QuetPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_receiving')) redirect('/f/warehouse/receiving');
  const brands = await listBrandDangCho();
  return <QuetNhanHang brands={brands} />;
}
