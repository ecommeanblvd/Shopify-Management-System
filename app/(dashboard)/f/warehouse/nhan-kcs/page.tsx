import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { timMonCuaDon, listDaXuLyHomNay } from '@/features/kho-nhan/queries';
import { BangNhanKcs } from '@/components/kho-nhan/BangNhanKcs';

export const dynamic = 'force-dynamic';

export default async function NhanKcsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }
  const sp = await searchParams;
  const donGoTay = typeof sp.don === 'string' ? sp.don : '';
  // Quét mã tem ĐƠN (O:<shopifyOrderId>) đưa thẳng shopifyOrderId qua URL — tra ngược sang
  // mã đơn người đọc trong timMonCuaDon (xem noteopts.theoOrderId), không phải gõ tay.
  const donId = typeof sp.donId === 'string' ? sp.donId : '';
  const [kq, homNay] = await Promise.all([
    donId ? timMonCuaDon('', { theoOrderId: donId }) : donGoTay ? timMonCuaDon(donGoTay) : Promise.resolve({ mon: [], loiLark: null, orderNumber: '' }),
    listDaXuLyHomNay(),
  ]);
  // Luôn ưu tiên mã đơn NGƯỜI ĐỌC mà truy vấn tra ra được (kq.orderNumber) — kể cả khi mở đơn
  // bằng quét (donId): thiếu bước này thì ô "Mã đơn"/tiêu đề trống VÀ hidden input orderNumber
  // gửi lên khi Lưu cũng trống, bị kiemViec (features/kho-nhan/luat.ts) từ chối "Thiếu mã đơn"
  // cho MỌI món của đơn mở bằng quét (review 23/09/2026 Critical 2). Không tìm ra đơn nào thì
  // giữ nguyên chuỗi người dùng đã gõ để thông báo "Không thấy món nào của đơn {don}" đúng ý.
  const don = kq.orderNumber || donGoTay;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhận hàng &amp; KCS</h1>
        <p className="text-sm text-muted-foreground">
          Gõ hoặc quét mã đơn, nhập số lượng, cân và kết quả kiểm cho từng món. SMS ghi thẳng sang bảng kho trên Lark.
        </p>
      </div>
      <BangNhanKcs don={don} mon={kq.mon} loiLark={kq.loiLark} homNay={homNay} coQuyenNhap={hasPermission(role, 'manage_qc')} />
    </div>
  );
}
