import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { donChoDong } from '@/features/dong-goi/queries';
import { BangDonChoDong } from '@/components/dong-goi/BangDonChoDong';

export const dynamic = 'force-dynamic';

/**
 * ĐÓNG HÀNG — kho đóng kiện cho đơn đã QC đạt.
 * Thiết kế: docs/superpowers/specs/2026-09-26-dong-hang-design.md
 */
export default async function DongGoiPage({
  searchParams,
}: {
  searchParams: Promise<{ kho?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const sp = await searchParams;
  const kho = sp.kho ?? '';
  const don = await donChoDong({ kho: kho || undefined });

  return (
    <div className="p-5">
      <BangDonChoDong don={don} kho={kho} />
    </div>
  );
}
