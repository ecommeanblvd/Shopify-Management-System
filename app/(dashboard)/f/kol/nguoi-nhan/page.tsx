import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { danhSachNguoiNhan, danhSachDon, monDangGiuCuaNguoiNhan, layNguoiNhan } from '@/features/kol/queries';
import { SoKol } from '@/components/kol/SoKol';

export const dynamic = 'force-dynamic';

export default async function SoKolPage({
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
  const q = typeof sp['q'] === 'string' ? sp['q'].trim() : '';
  const id = typeof sp['id'] === 'string' && sp['id'] ? sp['id'] : undefined;

  // Quản lý được cả hồ sơ đã ngừng dùng — người xem cần thấy để có thể bật lại.
  const tatCa = await danhSachNguoiNhan(true);
  const daLoc = q
    ? tatCa.filter((n) => n.ten.toLowerCase().includes(q.toLowerCase()))
    : tatCa;

  let chiTiet = null;
  if (id) {
    const hoSo = await layNguoiNhan(id);
    if (hoSo) {
      const [donDaGui, monDangGiu] = await Promise.all([
        danhSachDon({ trangThai: 'da_gui', nguoiNhanId: id }),
        monDangGiuCuaNguoiNhan(id),
      ]);
      chiTiet = { hoSo, donDaGui, monDangGiu };
    }
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div>
        <Link href="/f/kol" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          ← Đơn KOL &amp; chụp đồ
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sổ KOL</h1>
        <p className="text-sm text-muted-foreground">
          Hồ sơ người nhận hàng KOL / chụp đồ — thông tin liên hệ và tình trạng đang giữ hàng.
        </p>
      </div>
      <SoKol nguoiNhan={daLoc} q={q} idChon={id} chiTiet={chiTiet} canManage={canManage} />
    </div>
  );
}
