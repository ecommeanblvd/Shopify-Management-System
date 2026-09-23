import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { timMonCuaDon } from '@/features/kho-nhan/queries';
import { WAREHOUSE } from '@/features/kho-nhan/gia-tri-lark';
import { TemMon } from '@/components/kho-nhan/TemMon';

export const dynamic = 'force-dynamic';

/** `?mon=` có thể lặp nhiều lần (nhiều tem) — gộp, cắt khoảng trắng, bỏ trùng, chặn danh sách khổng lồ. */
function tachMon(v: string | string[] | undefined): string[] {
  const ds = Array.isArray(v) ? v : v != null ? [v] : [];
  return [...new Set(ds.map((x) => x.trim()).filter(Boolean))].slice(0, 500);
}

export default async function TemNhanKcsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const sp = await searchParams;
  const donRaw = typeof sp.don === 'string' ? sp.don : '';
  const dsMon = tachMon(sp.mon);
  // ?kho= là chuỗi TỰ DO trên URL — tab cũ, link chép lại, hay sửa tay đều gõ được bất cứ gì.
  // Chỉ nhận khi khớp NGUYÊN VĂN danh sách kho hợp lệ (WAREHOUSE) dùng chung toàn hệ thống;
  // sai thì coi như KHÔNG có, chứ không in một chuỗi rác lên tem dán vào hàng thật (review
  // 23/09/2026 Important). Đây chỉ là phương án DỰ PHÒNG cho món CHƯA có dòng wh_nhan_kcs —
  // món đã nhận thì lấy thẳng kho đã ghi (xem monChuaHuy.map bên dưới), không dùng param này.
  const khoThamSoHopLe = typeof sp.kho === 'string' && (WAREHOUSE as readonly string[]).includes(sp.kho.trim())
    ? sp.kho.trim()
    : null;

  if (!donRaw.trim()) {
    return <p className="p-6 text-sm text-muted-foreground">Thiếu mã đơn. Dùng ?don=&lt;mã đơn&gt;.</p>;
  }

  const { mon, orderNumber } = await timMonCuaDon(donRaw);
  if (!orderNumber) {
    return <p className="p-6 text-sm text-muted-foreground">Không thấy đơn {donRaw}.</p>;
  }

  const monCuaDon = dsMon.length > 0 ? mon.filter((m) => dsMon.includes(m.dinhDanh)) : mon;
  if (monCuaDon.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Không thấy món nào của đơn #{orderNumber} để in tem.</p>;
  }

  // Món đã huỷ không nhận vào kho — in tem cho nó là vô nghĩa, nhưng đếm rõ để không lặng lẽ bỏ qua.
  const monChuaHuy = monCuaDon.filter((m) => !m.huy);
  const soHuyBoQua = monCuaDon.length - monChuaHuy.length;

  return (
    <div className="py-4">
      <div className="khong-in px-4 pb-2">
        <h1 className="text-lg font-semibold tracking-tight">In tem — đơn #{orderNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {dsMon.length > 0 ? `${monCuaDon.length} món được chọn` : `Cả đơn · ${monCuaDon.length} món`}. Bấm &quot;In&quot; để mở hộp thoại in, &quot;Xong&quot; sau khi đã dán hết tem.
        </p>
      </div>
      <TemMon
        donTran={orderNumber}
        soHuyBoQua={soHuyBoQua}
        mon={monChuaHuy.map((m) => ({
          dinhDanh: m.dinhDanh, maTem: m.maTem, sku: m.sku, ten: m.lineitemName,
          // Kho THẬT đã nhận (wh_nhan_kcs.warehouse) mới đáng tin để in — chỉ rơi về tham số
          // URL đã kiểm hợp lệ khi món CHƯA có dòng nhận nào; không có cả hai thì để trống.
          kho: m.daNhan?.warehouse ?? khoThamSoHopLe,
        }))}
      />
    </div>
  );
}
