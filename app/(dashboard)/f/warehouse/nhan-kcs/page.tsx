import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { isStorageConfigured } from '@/lib/storage/s3';
import { danhSachDangKiem } from '@/features/kho-nhan/qc-actions';
import { anhCuaPhieu } from '@/features/kho-nhan/anh-nhan';
import { BangDangKiem } from '@/components/kho-nhan/BangDangKiem';

export const dynamic = 'force-dynamic';

export default async function NhanKcsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const dangKiem = await danhSachDangKiem();
  const anh = await anhCuaPhieu([...new Set(dangKiem.map((c) => c.receiptId))]);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhận hàng &amp; KCS</h1>
        <p className="text-sm text-muted-foreground">
          Tìm món chờ về rồi ghi nhận hàng vừa đến — hàng vào trạng thái <em>đang kiểm</em>, chưa
          vào tồn. Mỗi lô của một brand cần <strong>ảnh hàng đến</strong> (thấy đủ số lượng) và
          <strong> biên bản bàn giao</strong>. Kiểm đạt mới nhập kho; không đạt thì ghi chỗ lỗi để
          trả lại brand.
        </p>
      </div>
      <BangDangKiem dangKiem={dangKiem} anh={anh} coStorage={isStorageConfigured()} />
    </div>
  );
}
