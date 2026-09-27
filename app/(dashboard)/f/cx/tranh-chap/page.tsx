import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Scale } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listStoresBasic } from '@/features/customer-account/admin-queries';
import { danhSachDispute, disputeDangMo, tongTienTheoTrangThai } from '@/features/dispute/queries';
import { CONG, TRANG_THAI } from '@/features/dispute/chuan-hoa';
import { BangDispute } from '@/components/dispute/BangDispute';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ store?: string; cong?: string; tt?: string; nguon?: string }>;
}

export default async function TrangChapPage({ searchParams }: Props) {
  // Tự guard, không dựa vào layout: Next render layout và page song song nên
  // redirect của layout chưa kịp chạy thì query đã ném lỗi.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cx_dispute')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Không có quyền</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần quyền xem tranh chấp thanh toán. Nhờ quản trị cấp ở Roles.
        </p>
      </div>
    );
  }
  const coQuyenGhi = hasPermission(role, 'manage_cx_dispute');

  const stores = await listStoresBasic();
  const sp = await searchParams;
  // Lọc giá trị lạ từ URL ngay tại cửa.
  const storeId = sp.store && stores.some((s) => s.id === sp.store) ? sp.store : '';
  const cong = CONG.some((c) => c.ma === sp.cong) ? sp.cong! : '';
  const tt = (TRANG_THAI as readonly string[]).includes(sp.tt ?? '') ? sp.tt! : '';
  const nguon = sp.nguon === 'shopify' || sp.nguon === 'tay' ? sp.nguon : '';

  const [dangMo, tatCa, tong] = await Promise.all([
    disputeDangMo(),
    danhSachDispute({
      storeId: storeId || undefined,
      cong: cong || undefined,
      trangThai: tt || undefined,
      nguon: nguon || undefined,
    }),
    tongTienTheoTrangThai(),
  ]);

  return (
    <div className="space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Scale className="size-3.5" />
          CX
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Tranh chấp thanh toán</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ca Shopify Payments tự về từ Shopify mỗi 6 giờ, kèm hạn nộp bằng chứng.
          PayPal và Stripe nhập tay vì tranh chấp nằm trong dashboard riêng của họ.
          Số tiền luôn tách theo từng đơn vị tiền — không cộng gộp.
        </p>
      </header>

      <BangDispute
        dangMo={dangMo}
        tatCa={tatCa}
        tongTheoTrangThai={tong}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        coQuyenGhi={coQuyenGhi}
        loc={{ storeId, cong, trangThai: tt, nguon }}
      />
    </div>
  );
}
