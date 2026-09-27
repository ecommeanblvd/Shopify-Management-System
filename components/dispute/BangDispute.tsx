'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  CONG, NHAN_TRANG_THAI, TRANG_THAI, capBaoDong, conBaoNhieuNgay, nhanCong, nhanLyDo,
} from '@/features/dispute/chuan-hoa';
import { chuoiTongTien, gomTheoTienTe, type TongTheoTien } from '@/features/dispute/tong-tien';
import { dongBoNgay } from '@/features/dispute/actions';
import type { DongDispute } from '@/features/dispute/types';
import { NhapDispute } from './NhapDispute';
import { ModalDispute } from './ModalDispute';

interface StoreRef { id: string; name: string }

interface Props {
  dangMo: DongDispute[];
  tatCa: DongDispute[];
  tongTheoTrangThai: { trangThai: string; soCa: number; tong: TongTheoTien[] }[];
  stores: StoreRef[];
  coQuyenGhi: boolean;
  loc: { storeId: string; cong: string; trangThai: string; nguon: string };
}

const MAU_BAO_DONG: Record<string, string> = {
  qua_han: 'bg-red-500/15 text-red-700 dark:text-red-400',
  gap: 'bg-red-500/15 text-red-700 dark:text-red-400',
  sap: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  binh_thuong: 'bg-muted text-muted-foreground',
  khong_han: 'bg-muted text-muted-foreground',
};

function nhanHan(d: DongDispute, moc: Date): { chu: string; mau: string } {
  const conLai = conBaoNhieuNgay(d.hanNop, moc);
  const cap = capBaoDong(conLai, d.daNopLuc != null);
  const mau = MAU_BAO_DONG[cap] ?? MAU_BAO_DONG.binh_thuong!;
  if (d.daNopLuc) return { chu: 'đã nộp bằng chứng', mau };
  if (conLai == null) return { chu: 'không có hạn', mau };
  if (conLai < 0) return { chu: `quá hạn ${-conLai} ngày`, mau };
  return { chu: `còn ${conLai} ngày`, mau };
}

export function BangDispute({
  dangMo, tatCa, tongTheoTrangThai, stores, coQuyenGhi, loc,
}: Props) {
  const router = useRouter();
  const [moNhap, setMoNhap] = useState(false);
  const [xem, setXem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Mốc thời gian tính MỘT LẦN cho cả lượt render: gọi `new Date()` trong từng
  // dòng thì hai dòng có thể lệch ngày nhau ở ranh giới nửa đêm.
  const moc = useMemo(() => new Date(), []);

  const tongHienThi = useMemo(
    () => gomTheoTienTe(tatCa.map((d) => ({ soTien: d.soTien, tienTe: d.tienTe }))),
    [tatCa],
  );

  function doiLoc(next: Partial<typeof loc>) {
    const q = new URLSearchParams();
    const v = { ...loc, ...next };
    if (v.storeId) q.set('store', v.storeId);
    if (v.cong) q.set('cong', v.cong);
    if (v.trangThai) q.set('tt', v.trangThai);
    if (v.nguon) q.set('nguon', v.nguon);
    const s = q.toString();
    start(() => router.push(`/f/cx/tranh-chap${s ? `?${s}` : ''}`));
  }

  function sync() {
    start(async () => {
      const r = await dongBoNgay();
      if (!r.ok) { toast.error(r.loi ?? 'Đồng bộ thất bại.', { duration: 8000 }); return; }
      toast.success('Đã đồng bộ tranh chấp từ Shopify.', { duration: 3000 });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Tổng tiền TÁCH THEO ĐƠN VỊ TIỀN — không bao giờ cộng gộp. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Đang hiển thị</p>
          <p className="text-sm font-medium tabular-nums">{tatCa.length} ca</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Số tiền tranh chấp</p>
          <p className="text-sm font-medium tabular-nums">{chuoiTongTien(tongHienThi)}</p>
        </div>
        {tongTheoTrangThai.filter((t) => t.trangThai === 'won' || t.trangThai === 'lost').map((t) => (
          <div key={t.trangThai} className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {NHAN_TRANG_THAI[t.trangThai as 'won']} ({t.soCa})
            </p>
            <p className="text-sm font-medium tabular-nums">{chuoiTongTien(t.tong)}</p>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {coQuyenGhi && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={sync} disabled={pending}>
                {pending ? 'Đang chạy…' : 'Đồng bộ ngay'}
              </Button>
              <Button type="button" size="sm" onClick={() => setMoNhap(true)}>
                Nhập ca PayPal / Stripe
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Khối CẦN PHẢN HỒI — giá trị chính của màn. */}
      <section>
        <h2 className="mb-2 text-base font-semibold">
          Cần phản hồi <span className="font-normal text-muted-foreground">({dangMo.length})</span>
        </h2>
        {dangMo.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Không có ca nào đang chờ phản hồi.
          </p>
        ) : (
          <ul className="space-y-1">
            {dangMo.map((d) => {
              const h = nhanHan(d, moc);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setXem(d.id)}
                    className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${h.mau}`}>{h.chu}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {d.tienTe} {Number(d.soTien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {d.maDon ?? '—'} · {nhanLyDo(d.lyDo)} · {nhanCong(d.congThanhToan)} · {d.store}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {NHAN_TRANG_THAI[d.trangThai as 'needs_response'] ?? d.trangThai}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Bảng tất cả */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Tất cả tranh chấp</h2>
          <select
            value={loc.storeId} onChange={(e) => doiLoc({ storeId: e.target.value })}
            aria-label="Lọc theo store"
            className="ml-auto h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={loc.cong} onChange={(e) => doiLoc({ cong: e.target.value })}
            aria-label="Lọc theo cổng thanh toán"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi cổng</option>
            {CONG.map((c) => <option key={c.ma} value={c.ma}>{c.ten}</option>)}
          </select>
          <select
            value={loc.trangThai} onChange={(e) => doiLoc({ trangThai: e.target.value })}
            aria-label="Lọc theo trạng thái"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi trạng thái</option>
            {TRANG_THAI.map((t) => <option key={t} value={t}>{NHAN_TRANG_THAI[t]}</option>)}
          </select>
          <select
            value={loc.nguon} onChange={(e) => doiLoc({ nguon: e.target.value })}
            aria-label="Lọc theo nguồn"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi nguồn</option>
            <option value="shopify">Từ Shopify</option>
            <option value="tay">CX nhập tay</option>
          </select>
        </div>

        {tatCa.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Không có ca nào khớp bộ lọc.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Mở</th>
                  <th className="px-3 py-2 font-medium">Đơn</th>
                  <th className="px-3 py-2 font-medium">Số tiền</th>
                  <th className="px-3 py-2 font-medium">Lý do</th>
                  <th className="px-3 py-2 font-medium">Cổng</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Hạn nộp</th>
                </tr>
              </thead>
              <tbody>
                {tatCa.map((d) => {
                  const h = nhanHan(d, moc);
                  return (
                    <tr
                      key={d.id} onClick={() => setXem(d.id)}
                      className="cursor-pointer border-t border-border hover:bg-muted/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {d.moLuc?.toLocaleDateString('vi-VN') ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {d.maDon ?? '—'}
                        {d.maDon && !d.coDonTrongHeThong && (
                          <span
                            title="Đơn này chưa có trong hệ thống — phần lớn là đơn 2023 chưa sync"
                            className="ml-1 text-xs text-muted-foreground"
                          >
                            ?
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                        {d.tienTe} {Number(d.soTien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {nhanLyDo(d.lyDo)}
                        {d.lyDoMang && <span className="ml-1 font-mono text-muted-foreground">{d.lyDoMang}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{nhanCong(d.congThanhToan)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {NHAN_TRANG_THAI[d.trangThai as 'lost'] ?? d.trangThai}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${h.mau}`}>{h.chu}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={moNhap} onOpenChange={setMoNhap}>
        <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-[680px]">
          <DialogTitle className="text-base font-semibold">Nhập ca PayPal / Stripe</DialogTitle>
          <NhapDispute stores={stores} onXong={() => { setMoNhap(false); router.refresh(); }} />
        </DialogContent>
      </Dialog>

      <ModalDispute
        id={xem} coQuyenGhi={coQuyenGhi}
        onDong={() => setXem(null)} onDoi={() => router.refresh()}
      />
    </div>
  );
}
