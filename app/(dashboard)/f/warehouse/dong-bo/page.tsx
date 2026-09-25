import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { ngayKinhDoanh } from '@/lib/timezone';
import { soNhap, ngayCoHang } from '@/features/kho-nhan/so-nhap';
import { BangSoNhap } from '@/components/kho-nhan/BangSoNhap';

export const dynamic = 'force-dynamic';

/**
 * SỔ NHẬP KHO & ĐỐI CHIẾU LARK.
 *
 * CEO 25/09: chiếc đã nhận & kiểm trong ngày đẩy hết sang đây, để màn Nhận &
 * Kiểm mỗi phiên làm chỉ còn việc của phiên đó.
 */
export default async function DongBoPage({
  searchParams,
}: {
  // Bản Next này trả searchParams dưới dạng Promise — phải await.
  searchParams: Promise<{ ngay?: string; kho?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const sp = await searchParams;
  const cacNgay = await ngayCoHang();
  // Mặc định là hôm nay; hôm nay chưa nhận gì thì rơi về ngày gần nhất CÓ hàng,
  // để trang không mở ra trống trơn rồi tưởng mất dữ liệu.
  const homNay = ngayKinhDoanh(new Date())!;
  const ngay = sp.ngay || (cacNgay.includes(homNay) ? homNay : cacNgay[0] ?? homNay);
  const kho = sp.kho ?? '';
  const dong = await soNhap({ ngay, kho: kho || undefined });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sổ nhập kho &amp; đối chiếu Lark</h1>
        <p className="text-sm text-muted-foreground">
          Mọi chiếc đã ghi nhận, dựng theo đúng hình bảng Lark <em>WH - Inventory</em>. Nút đối
          chiếu chỉ ĐỌC hai bên và chỉ ra chỗ lệch — không tự sửa bên nào.
        </p>
      </div>
      <BangSoNhap dong={dong} ngay={ngay} kho={kho} cacNgay={cacNgay} />
    </div>
  );
}
