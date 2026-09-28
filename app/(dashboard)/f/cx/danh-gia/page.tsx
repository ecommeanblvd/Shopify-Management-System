import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Star } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { TRANG, TRANG_THAI } from '@/features/danh-gia/phan-loai';
import { brandCoDanhGia, danhSachDanhGia, tongHopDanhGia } from '@/features/danh-gia/queries';
import { BangDanhGia } from '@/components/danh-gia/BangDanhGia';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ sao?: string; trang?: string; tt?: string; brand?: string; cc?: string }>;
}

export default async function DanhGiaPage({ searchParams }: Props) {
  // Tự guard: Next render layout và page song song nên redirect của layout chưa
  // kịp chạy thì query đã ném lỗi.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cx_review')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Không có quyền</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần quyền xem đánh giá. Nhờ quản trị cấp ở Roles.
        </p>
      </div>
    );
  }
  const coQuyenGhi = hasPermission(role, 'manage_cx_review');

  const sp = await searchParams;
  const saoSo = Number(sp.sao);
  const sao = Number.isInteger(saoSo) && saoSo >= 1 && saoSo <= 5 ? saoSo : undefined;
  const trang = TRANG.some((t) => t.ma === sp.trang) ? sp.trang! : '';
  const tt = TRANG_THAI.some((t) => t.ma === sp.tt) ? sp.tt! : '';
  const cc = sp.cc === '1';

  const brands = await brandCoDanhGia();
  const brand = sp.brand && brands.includes(sp.brand) ? sp.brand : '';

  const [danhGia, tongHop] = await Promise.all([
    danhSachDanhGia({
      soSao: sao,
      trang: trang || undefined,
      trangThai: tt || undefined,
      vendor: brand || undefined,
      canChua: cc,
    }),
    tongHopDanhGia(),
  ]);

  return (
    <div className="space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Star className="size-3.5" />
          CX
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Đánh giá</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Đánh giá Trustpilot và Judge.me. Ưu tiên ca 1–2 sao chưa xử lý, và xem
          brand nào đang nhận nhiều đánh giá tệ nhất.
        </p>
      </header>

      <BangDanhGia
        danhGia={danhGia}
        tongHop={tongHop}
        brands={brands}
        coQuyenGhi={coQuyenGhi}
        loc={{
          soSao: sao ? String(sao) : '',
          trang, trangThai: tt, vendor: brand, canChua: cc,
        }}
      />
    </div>
  );
}
