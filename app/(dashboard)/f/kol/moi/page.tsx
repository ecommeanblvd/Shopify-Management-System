import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { danhSachNguoiNhan } from '@/features/kol/queries';
import { FormDonMoi } from '@/components/kol/FormDonMoi';

export const dynamic = 'force-dynamic';

export default async function TaoDonKolPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_kol')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const nguoiNhan = await danhSachNguoiNhan();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Tạo đơn KOL / chụp đồ</h1>
        <p className="text-sm text-muted-foreground">
          Đơn tạo ở trạng thái nháp, chưa đụng tồn kho — chốt đơn mới giữ chỗ.
        </p>
      </div>
      <FormDonMoi nguoiNhan={nguoiNhan} />
    </div>
  );
}
