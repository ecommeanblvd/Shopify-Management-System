import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { boPhanHopLe } from '@/features/to-chuc/bo-phan';
import { NGUYEN_NHAN, TRANG_THAI } from '@/features/su-co/phan-loai';
import { danhSachSuCo, tongHopThietHai } from '@/features/su-co/queries';
import { BangSuCo } from '@/components/su-co/BangSuCo';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ tt?: string; nn?: string; bp?: string; xl?: string }>;
}

export default async function SuCoPage({ searchParams }: Props) {
  // Tự guard: Next render layout và page song song nên redirect của layout chưa
  // kịp chạy thì query đã ném lỗi.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cx_incident')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Không có quyền</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần quyền xem sự cố &amp; thiệt hại. Nhờ quản trị cấp ở Roles.
        </p>
      </div>
    );
  }
  const coQuyenGhi = hasPermission(role, 'manage_cx_incident');

  const sp = await searchParams;
  const tt = (TRANG_THAI as readonly string[]).includes(sp.tt ?? '') ? sp.tt! : '';
  const nn = NGUYEN_NHAN.some((n) => n.ma === sp.nn) ? sp.nn! : '';
  const bp = sp.bp && boPhanHopLe(sp.bp) ? sp.bp : '';
  const xl = sp.xl === '1';

  const [suCo, tongHop] = await Promise.all([
    danhSachSuCo({
      trangThai: tt || undefined,
      nguyenNhan: nn || undefined,
      boPhan: bp || undefined,
      canXemLai: xl,
    }),
    tongHopThietHai(),
  ]);

  return (
    <div className="space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <TriangleAlert className="size-3.5" />
          CX
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Sự cố &amp; thiệt hại</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Mỗi khoản chi phí là một dòng riêng, gắn đúng một bộ phận — nên tổng theo
          bộ phận luôn bằng tổng thật. Số tiền tách theo từng đơn vị tiền, không cộng gộp.
        </p>
      </header>

      <BangSuCo
        suCo={suCo}
        tongHop={tongHop}
        coQuyenGhi={coQuyenGhi}
        loc={{ trangThai: tt, nguyenNhan: nn, boPhan: bp, canXemLai: xl }}
      />
    </div>
  );
}
