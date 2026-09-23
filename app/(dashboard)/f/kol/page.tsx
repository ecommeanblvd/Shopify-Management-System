import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { danhSachDon, danhSachNguoiNhan, dongBaoCaoChiPhi } from '@/features/kol/queries';
import { dangUuid } from '@/features/kol/uuid';
import { tiGiaThang } from '@/features/cogs/queries';
import { gomTheoThang, gomTheoNguoiNhan } from '@/features/kol/bao-cao';
import { tongChiPhi } from '@/features/kol/chi-phi';
import { thangKinhDoanh } from '@/lib/timezone';
import { BangDonKol } from '@/components/kol/BangDonKol';
import { TomTatChiPhi } from '@/components/kol/TomTatChiPhi';
import { ModalTaoDon } from '@/components/kol/ModalTaoDon';
import type { TrangThaiDon } from '@/features/kol/types';

export const dynamic = 'force-dynamic';

const TRANG_THAI_HOP_LE: readonly TrangThaiDon[] = ['nhap', 'da_chot', 'da_gui', 'huy'];

export default async function DanhSachKolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_kol');
  const sp = await searchParams;
  const trangThaiRaw = typeof sp['trangThai'] === 'string' ? sp['trangThai'] : undefined;
  const trangThai = TRANG_THAI_HOP_LE.includes(trangThaiRaw as TrangThaiDon) ? trangThaiRaw : undefined;
  // Cùng lý do với whitelist trạng thái ngay trên: giá trị tới từ query string
  // nên có thể là rác gõ tay. Một chuỗi không phải uuid ép vào cột uuid làm
  // Postgres ném 22P02 và HỎNG CẢ TRANG — coi như không lọc thì an toàn hơn.
  const nguoiNhanIdRaw = typeof sp['nguoiNhanId'] === 'string' ? sp['nguoiNhanId'] : undefined;
  const nguoiNhanId = dangUuid(nguoiNhanIdRaw) ? nguoiNhanIdRaw : undefined;

  const [dons, nguoiNhanOptions, dongBaoCao, rates] = await Promise.all([
    danhSachDon({ trangThai, nguoiNhanId }),
    danhSachNguoiNhan(true),
    dongBaoCaoChiPhi(),
    tiGiaThang(),
  ]);
  const thangHienTai = thangKinhDoanh(new Date())!;
  // Headline VÀ bảng "Theo KOL" chỉ tính hàng ĐÃ GỬI (guiLuc khác null) —
  // dòng chưa gửi (nháp/đã chốt) chưa hề rời kho, số lượng mượn của nó luôn
  // đổ nguyên vào "đang treo" như thể đang ở nhà KOL, dù thật ra nó nằm
  // nguyên trên kệ dưới diện giữ chỗ.
  //
  // Bảng "Theo KOL" đặc biệt nguy hiểm nếu lọt dữ liệu chưa gửi vào: nó gắn
  // số đó với MỘT NGƯỜI CỤ THỂ theo tên, không có "khoá chưa gửi" nào để dán
  // nhãn tách biệt như bảng theo tháng có — người đọc thấy dòng "Chưa gửi"
  // dưới tên một KOL thì hiểu là người đó đang giữ hàng, rồi nhắn tin đòi lại
  // thứ chưa từng được gửi. Filter round 2 (fix round 2).
  //
  // Bảng "Theo tháng" bên dưới vẫn nhận `dongBaoCao` KHÔNG lọc — đây là nơi
  // DUY NHẤT còn cho hàng chưa gửi lộ diện, và nó có nhãn "Chưa gửi" rõ ràng
  // để không ai hiểu nhầm là "đang ở nhà KOL".
  const daGui = dongBaoCao.filter((d) => d.guiLuc !== null);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Đơn KOL &amp; chụp đồ</h1>
          <p className="text-sm text-muted-foreground">
            Hàng gửi KOL / dùng chụp đồ — tách khỏi đơn bán, không đụng số liệu Shopify.
          </p>
          <div className="mt-1 flex gap-3 text-sm">
            <Link href="/f/kol/nguoi-nhan" className="text-primary underline-offset-2 hover:underline">Sổ KOL</Link>
            <Link href="/f/kol/dang-muon" className="text-primary underline-offset-2 hover:underline">Đang mượn</Link>
          </div>
        </div>
        {canManage && <ModalTaoDon nguoiNhan={nguoiNhanOptions} />}
      </div>
      <TomTatChiPhi
        theoThang={gomTheoThang(dongBaoCao)}
        theoNguoiNhan={gomTheoNguoiNhan(daGui)}
        tongTatCa={tongChiPhi(daGui)}
        rates={rates}
        thangHienTai={thangHienTai}
      />
      <BangDonKol
        dons={dons}
        nguoiNhanOptions={nguoiNhanOptions}
        trangThai={trangThai}
        nguoiNhanId={nguoiNhanId}
      />
    </div>
  );
}
