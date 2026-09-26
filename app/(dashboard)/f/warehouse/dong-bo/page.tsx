import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { soNhap, larkCapNhatLuc, ngayCoDong } from '@/features/kho-nhan/so-nhap';
import { ngayKinhDoanh } from '@/lib/timezone';
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
  searchParams: Promise<{ kho?: string; ngay?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const sp = await searchParams;
  const kho = sp.kho ?? '';
  const homNay = ngayKinhDoanh(new Date())!;
  // Một ngày mỗi lượt, mặc định hôm nay — màn có lịch chọn ngày (bản thiết kế
  // CEO 26/09). Ngày tương lai kẹp về hôm nay: sổ không ghi việc chưa xảy ra.
  const ngay = sp.ngay && sp.ngay <= homNay ? sp.ngay : homNay;
  const [dong, cacNgay, capNhatLuc] = await Promise.all([
    soNhap({ kho: kho || undefined, ngay }),
    ngayCoDong(kho || undefined),
    larkCapNhatLuc(),
  ]);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col p-5">
      <BangSoNhap
        dong={dong} kho={kho} ngay={ngay} homNay={homNay}
        cacNgay={cacNgay} capNhatLuc={capNhatLuc}
      />
    </div>
  );
}
