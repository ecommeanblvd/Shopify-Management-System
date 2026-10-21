import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listKienDongHang, listKienChoKhop, demKienChuaCan, danhSachBox, GIOI_HAN_KIEN } from '@/features/dong-hang/queries';
import { BO_LOC, type BoLocDongHang } from '@/features/dong-hang/types';
import { BangDongHang } from '@/components/dong-hang/BangDongHang';
import { NutNhatKy } from '@/components/nhat-ky/NutNhatKy';

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
  const loc: BoLocDongHang = (BO_LOC as readonly string[]).includes(locRaw) ? (locRaw as BoLocDongHang) : 'cho_chon_line';
  const q = typeof sp.q === 'string' ? sp.q : '';

  const [kien, choKhop, soKienChuaCan, dsBox] = await Promise.all([
    listKienDongHang(loc, q), listKienChoKhop(), demKienChuaCan(), danhSachBox(),
  ]);

  return (
    <div className="space-y-4 p-6">
      {/* Khuôn header chung của mọi module: tiêu đề + MỘT dòng mô tả bên trái, nút Nhật ký
          là phần tử CUỐI bên phải. Vị trí nút phải GIỐNG HỆT ở cả 5 module (CEO 20/10/2026)
          — người dùng phải tìm thấy nút ở cùng một chỗ mỗi lần.

          Riêng màn này, hàng header do `BangDongHang` dựng chứ không phải trang: hai thẻ số
          "chờ / đã chọn line" đếm theo state lạc quan `chonCucBo` bên trong bảng, chọn hãng
          xong là nhảy ngay chứ không đợi vòng revalidate. Muốn thẻ số đứng CÙNG hàng với
          tiêu đề mà vẫn giữ được tính đó thì hàng header phải nằm trong bảng, nên trang
          truyền nút Nhật ký xuống như một slot. Trang vẫn là nơi DUY NHẤT khai tên bảng
          thật, giống 4 module kia. */}
      <BangDongHang
        nhatKy={<NutNhatKy bang="shipments" />}
        kien={kien}
        choKhop={choKhop}
        loc={loc}
        q={q}
        coQuyenChon={hasPermission(role, 'chon_line_ship')}
        coQuyenDong={hasPermission(role, 'manage_fulfillment')}
        coQuyenVanDon={hasPermission(role, 'tao_van_don')}
        gioiHan={GIOI_HAN_KIEN}
        soKienChuaCan={soKienChuaCan}
        dsBox={dsBox}
      />
    </div>
  );
}
