import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Headset } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { tongQuanCx } from '@/features/cx/tong-quan';
import { TrangHomNay } from '@/components/cx/TrangHomNay';

export const dynamic = 'force-dynamic';

export default async function CxHomNayPage() {
  // Tự guard: Next render layout và page SONG SONG nên redirect của layout chưa
  // kịp chạy thì truy vấn đã ném lỗi.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  const coQuyen = role && (
    hasPermission(role, 'view_cx_ticket')
    || hasPermission(role, 'view_cx_dispute')
    || hasPermission(role, 'view_cx_incident')
    || hasPermission(role, 'view_cx_review')
  );
  if (!coQuyen) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Không có quyền</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần ít nhất một quyền xem của module CX. Nhờ quản trị cấp ở Roles.
        </p>
      </div>
    );
  }

  const tq = await tongQuanCx();

  return (
    <div className="space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Headset className="size-3.5" />
          CX
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Hôm nay</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Việc đang treo ở cả năm module, xếp theo hậu quả nếu bỏ qua. Việc có hạn
          cứng luôn ở nhóm trên — một tranh chấp sắp hết hạn nộp bằng chứng là mất
          tiền thật, kể cả khi là hồ sơ nhập từ Lark.
        </p>
      </header>

      <TrangHomNay tq={tq} />
    </div>
  );
}
