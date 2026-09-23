import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { timMonCuaDon } from '@/features/kho-nhan/queries';
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
  // Kho không có chỗ lưu theo món (spec §5 không đòi cột mới) — lấy đúng kho đang chọn trên
  // màn Nhận & KCS lúc bấm In tem (BangNhanKcs truyền qua ?kho=), không tự suy đoán.
  const kho = typeof sp.kho === 'string' && sp.kho.trim() ? sp.kho.trim() : '—';

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
        kho={kho}
        soHuyBoQua={soHuyBoQua}
        mon={monChuaHuy.map((m) => ({ dinhDanh: m.dinhDanh, maTem: m.maTem, sku: m.sku, ten: m.lineitemName }))}
      />
    </div>
  );
}
