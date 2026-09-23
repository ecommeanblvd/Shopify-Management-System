import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { danhSachDon, danhSachNguoiNhan } from '@/features/kol/queries';
import { BangDonKol } from '@/components/kol/BangDonKol';
import { buttonVariants } from '@/components/ui/button';
import type { TrangThaiDon } from '@/features/kol/types';

export const dynamic = 'force-dynamic';

const TRANG_THAI_HOP_LE: readonly TrangThaiDon[] = ['nhap', 'da_chot', 'da_gui', 'huy'];

export default async function DanhSachKolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_kol');
  const sp = await searchParams;
  const trangThaiRaw = typeof sp['trangThai'] === 'string' ? sp['trangThai'] : undefined;
  const trangThai = TRANG_THAI_HOP_LE.includes(trangThaiRaw as TrangThaiDon) ? trangThaiRaw : undefined;
  const nguoiNhanId = typeof sp['nguoiNhanId'] === 'string' && sp['nguoiNhanId'] ? sp['nguoiNhanId'] : undefined;

  const [dons, nguoiNhanOptions] = await Promise.all([
    danhSachDon({ trangThai, nguoiNhanId }),
    danhSachNguoiNhan(true),
  ]);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Đơn KOL &amp; chụp đồ</h1>
          <p className="text-sm text-muted-foreground">
            Hàng gửi KOL / dùng chụp đồ — tách khỏi đơn bán, không đụng số liệu Shopify.
          </p>
        </div>
        {canManage && (
          <Link href="/f/kol/moi" className={buttonVariants({})}>+ Tạo đơn</Link>
        )}
      </div>
      <BangDonKol
        dons={dons}
        nguoiNhanOptions={nguoiNhanOptions}
        trangThai={trangThai}
        nguoiNhanId={nguoiNhanId}
      />
    </div>
  );
}
