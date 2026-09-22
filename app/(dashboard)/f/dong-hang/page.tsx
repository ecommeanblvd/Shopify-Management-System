import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listKienDongHang, listKienChoKhop, GIOI_HAN_KIEN } from '@/features/dong-hang/queries';
import { BO_LOC, type BoLocDongHang } from '@/features/dong-hang/types';
import { BangDongHang } from '@/components/dong-hang/BangDongHang';

export const dynamic = 'force-dynamic';

export default async function DongHangPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');

  const sp = await searchParams;
  const locRaw = typeof sp.loc === 'string' ? sp.loc : '';
  const loc: BoLocDongHang = (BO_LOC as readonly string[]).includes(locRaw) ? (locRaw as BoLocDongHang) : 'chua_tracking';
  const q = typeof sp.q === 'string' ? sp.q : '';

  const [kien, choKhop] = await Promise.all([listKienDongHang(loc, q), listKienChoKhop()]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Đóng hàng</h1>
        <p className="text-sm text-muted-foreground">
          Kiện đóng xong trên Lark về đây trong vài giây. So cước theo cân thực + kích thước rồi chọn line ship; hãng được ghi lên cột Couriers của Lark.
        </p>
      </div>
      <BangDongHang
        kien={kien}
        choKhop={choKhop}
        loc={loc}
        q={q}
        coQuyenChon={hasPermission(role, 'manage_fulfillment')}
        gioiHan={GIOI_HAN_KIEN}
      />
    </div>
  );
}
