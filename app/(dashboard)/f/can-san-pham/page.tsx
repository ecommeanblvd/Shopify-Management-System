import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { docDeXuatCan } from '@/features/can-san-pham/actions';
import { BangDeXuatCan } from '@/components/can-san-pham/BangDeXuatCan';

export const dynamic = 'force-dynamic';

/**
 * Sửa cân sản phẩm (CEO 16/09/2026): các SKU mà đơn âm cước cho thấy cân trên web thấp hơn cân
 * hãng tính. Quản lý xem bằng chứng rồi bấm duyệt, hệ thống đẩy cân mới lên Shopify.
 */
export default async function CanSanPhamPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) redirect('/');

  const trang = await docDeXuatCan();
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sửa cân sản phẩm</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Checkout báo cước bằng tổng cân các biến thể trên Shopify, còn hãng tính theo cân của cả thùng đã đóng.
          Web khai thấp hơn thì đơn nào cũng âm cước. Danh sách lấy từ các đơn âm cước đã giải trình là
          &ldquo;cân web thấp&rdquo; ở{' '}
          <Link href="/f/ship-report?tab=kpi" className="underline">tiêu chí 1.1</Link>.
        </p>
      </div>
      <BangDeXuatCan trang={trang} />
    </div>
  );
}
