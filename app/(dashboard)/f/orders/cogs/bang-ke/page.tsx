import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { BangKeImporter } from '@/components/cogs/BangKeImporter';
import { PhanBoPOButton } from '@/components/cogs/PhanBoPOButton';
import { layBrands } from '@/features/cogs/actions';

export const dynamic = 'force-dynamic';

export default async function BangKeBrandPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_cogs')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }

  const brands = await layBrands();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight">Bảng kê thanh toán brand</h1>
        <p className="text-sm text-muted-foreground">
          Sheet cần được mở chế độ &quot;ai có link đều xem được&quot; để hệ thống đọc trực tiếp.
          <br />
          Chỉ những tab bảng kê thực nhận (không phải tab tổng hợp/nháp) mới được nhập.
          <br />
          Nhập lại một kỳ đã áp dụng sẽ thay thế toàn bộ dữ liệu giá vốn của kỳ đó.
        </p>
      </header>

      <BangKeImporter brands={brands} />

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Phân bổ hàng PO xuống đơn</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Dòng đơn không có trên bảng kê nhưng SKU (mã · size · màu) nằm trong PO MEAN đã mua của brand → lấy giá vốn theo PO,
          nhập trước dùng trước, chỉ PO kỳ trước hoặc cùng tháng đặt mới được tính; hết số lượng thì chuyển PO kế tiếp.
          Chạy lại bất kỳ lúc nào (xoá và phân bổ lại toàn bộ dòng nguồn PO của brand).
        </p>
        <PhanBoPOButton brands={brands} />
      </section>
    </div>
  );
}
