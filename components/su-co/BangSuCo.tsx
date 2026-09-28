'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BO_PHAN, nhanBoPhan } from '@/features/to-chuc/bo-phan';
import {
  NGUYEN_NHAN, NHAN_TRANG_THAI, TRANG_THAI, nhanLoaiChiPhi, nhanNguyenNhan,
} from '@/features/su-co/phan-loai';
import { chuoiTongTien, gomTheoTienTe } from '@/features/dispute/tong-tien';
import type { DongSuCo } from '@/features/su-co/types';
import type { TongHopThietHai } from '@/features/su-co/queries';
import { KhoiTongHop } from './KhoiTongHop';
import { GhiSuCo } from './GhiSuCo';
import { ModalSuCo } from './ModalSuCo';

interface Props {
  suCo: DongSuCo[];
  tongHop: TongHopThietHai;
  coQuyenGhi: boolean;
  loc: { trangThai: string; nguyenNhan: string; boPhan: string; canXemLai: boolean };
}

export function BangSuCo({ suCo, tongHop, coQuyenGhi, loc }: Props) {
  const router = useRouter();
  const [moGhi, setMoGhi] = useState(false);
  const [xem, setXem] = useState<string | null>(null);
  const [, start] = useTransition();

  function doiLoc(next: Partial<typeof loc>) {
    const v = { ...loc, ...next };
    const q = new URLSearchParams();
    if (v.trangThai) q.set('tt', v.trangThai);
    if (v.nguyenNhan) q.set('nn', v.nguyenNhan);
    if (v.boPhan) q.set('bp', v.boPhan);
    if (v.canXemLai) q.set('xl', '1');
    const s = q.toString();
    start(() => router.push(`/f/cx/su-co${s ? `?${s}` : ''}`));
  }

  return (
    <div className="space-y-6">
      <KhoiTongHop th={tongHop} />

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Danh sách sự cố</h2>
          <select
            value={loc.trangThai} onChange={(e) => doiLoc({ trangThai: e.target.value })}
            aria-label="Lọc theo trạng thái"
            className="ml-auto h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi trạng thái</option>
            {TRANG_THAI.map((t) => <option key={t} value={t}>{NHAN_TRANG_THAI[t]}</option>)}
          </select>
          <select
            value={loc.nguyenNhan} onChange={(e) => doiLoc({ nguyenNhan: e.target.value })}
            aria-label="Lọc theo nguyên nhân"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi nguyên nhân</option>
            {NGUYEN_NHAN.map((n) => <option key={n.ma} value={n.ma}>{n.ten}</option>)}
          </select>
          <select
            value={loc.boPhan} onChange={(e) => doiLoc({ boPhan: e.target.value })}
            aria-label="Lọc theo bộ phận"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi bộ phận</option>
            {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox" checked={loc.canXemLai}
              onChange={(e) => doiLoc({ canXemLai: e.target.checked })}
            />
            Cần xem lại
          </label>
          {coQuyenGhi && (
            <Button type="button" size="sm" onClick={() => setMoGhi(true)}>Ghi sự cố</Button>
          )}
        </div>

        {suCo.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Không có sự cố nào khớp bộ lọc.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ngày</th>
                  <th className="px-3 py-2 font-medium">Mã</th>
                  <th className="px-3 py-2 font-medium">Nguyên nhân</th>
                  <th className="px-3 py-2 font-medium">Đơn</th>
                  <th className="px-3 py-2 font-medium">Bộ phận chịu</th>
                  <th className="px-3 py-2 font-medium">Thiệt hại</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {suCo.map((s) => {
                  const tong = gomTheoTienTe(s.chiPhi.map((c) => ({ soTien: c.soTien, tienTe: c.tienTe })));
                  return (
                    <tr
                      key={s.id} onClick={() => setXem(s.id)}
                      className="cursor-pointer border-t border-border hover:bg-muted/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{s.ngayBao}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {s.maSuCo}
                        {s.canXemLai && (
                          <span
                            title="Dữ liệu nhập từ Lark không đủ để suy cách quy trách nhiệm — cần rà lại"
                            className="ml-1 text-amber-600 dark:text-amber-400"
                          >
                            !
                          </span>
                        )}
                      </td>
                      <td className="max-w-[240px] px-3 py-2">
                        <span className="block truncate">{nhanNguyenNhan(s.nguyenNhan)}</span>
                        {s.chiPhi.length > 0 && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.chiPhi.map((c) => nhanLoaiChiPhi(c.loai)).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{s.maDon ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {s.boPhanChinh ? nhanBoPhan(s.boPhanChinh)
                          : <span className="text-muted-foreground">chưa ghi</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                        {chuoiTongTien(tong)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {NHAN_TRANG_THAI[s.trangThai as 'mo'] ?? s.trangThai}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={moGhi} onOpenChange={setMoGhi}>
        <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-[760px]">
          <DialogTitle className="text-base font-semibold">Ghi sự cố</DialogTitle>
          <GhiSuCo onXong={() => { setMoGhi(false); router.refresh(); }} />
        </DialogContent>
      </Dialog>

      <ModalSuCo
        id={xem} coQuyenGhi={coQuyenGhi}
        onDong={() => setXem(null)} onDoi={() => router.refresh()}
      />
    </div>
  );
}
