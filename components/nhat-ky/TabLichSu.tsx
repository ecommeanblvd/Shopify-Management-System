import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { nhatKyCuaBanGhi } from '@/features/nhat-ky/queries';
import { Card, CardContent } from '@/components/ui/card';
import { BangNhatKy } from './BangNhatKy';

/**
 * Tab "Lịch sử" của MỘT bản ghi (spec §6a) — gắn được vào bất kỳ màn chi tiết nào.
 *
 * Tự gác quyền `view_nhat_ky` thay vì để `nhatKyCuaBanGhi` ném `Forbidden`: tab này sống
 * BÊN TRONG màn của module khác (chi tiết lô nhập kho), nên một lỗi ném ra ở đây làm sập
 * cả màn đó — người dùng mất luôn danh sách hàng chỉ vì không được xem nhật ký. Thiếu
 * quyền thì nói một câu rồi thôi.
 *
 * `nhatKyCuaBanGhi` vẫn gác lại lần nữa ở tầng truy vấn (và đó là hàng rào thật — hàng rào
 * ở đây chỉ để câu trả lời "không có quyền" đẹp hơn một trang lỗi).
 */
export async function TabLichSu({ bang, banGhiId }: { bang: string; banGhiId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = session ? await getRole(session.user.id) : null;
  if (!role || !hasPermission(role, 'view_nhat_ky')) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Vai trò của bạn chưa có quyền xem nhật ký thay đổi.
        </CardContent>
      </Card>
    );
  }

  const khoi = await nhatKyCuaBanGhi(bang, banGhiId);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Lịch sử thay đổi ({khoi.length})</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mới nhất trước. Gồm cả thay đổi trên từng dòng con của bản ghi này.
          </p>
        </div>
        <BangNhatKy
          khoi={khoi}
          banGhiDangMo={banGhiId}
          trong="Chưa có thay đổi nào được ghi cho bản ghi này."
        />
      </CardContent>
    </Card>
  );
}
