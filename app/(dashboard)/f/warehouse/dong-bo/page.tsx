import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { soNhap } from '@/features/kho-nhan/so-nhap';
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
  // KHÔNG lọc theo một ngày nữa: trang chia thành từng mảng theo ngày giống
  // hệt bảng Lark (CEO 25/09), nên phải lấy nhiều ngày một lượt.
  const dong = await soNhap({ kho: kho || undefined });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sổ nhập kho &amp; đối chiếu Lark</h1>
        <p className="text-sm text-muted-foreground">
          Mọi chiếc đã ghi nhận, chia theo ngày và dựng theo đúng hình bảng Lark
          <em> WH - Inventory</em>. Nút đối chiếu chỉ ĐỌC hai bên và chỉ ra chỗ lệch — không tự
          sửa bên nào.
        </p>
      </div>
      <BangSoNhap dong={dong} kho={kho} />
    </div>
  );
}
