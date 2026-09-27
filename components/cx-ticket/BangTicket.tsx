'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { NHOM, BO_PHAN, nhanBoPhan, nhanLoai } from '@/features/cx-ticket/phan-loai';
import { NHAN_TICKET, NHAN_VIEC, TRANG_THAI_TICKET } from '@/features/cx-ticket/trang-thai';
import type { DongTicket } from '@/features/cx-ticket/types';
import { TaoTicket } from './TaoTicket';
import { ModalChiTiet } from './ModalChiTiet';

interface Props {
  ticket: DongTicket[];
  dem: Record<string, number>;
  boPhanMinh: string | null;
  toanQuyen: boolean;
  locTrangThai: string;
  locNhom: string;
  locBoPhan: string;
  locCuaToi: boolean;
}

export function BangTicket({
  ticket, dem, boPhanMinh, toanQuyen, locTrangThai, locNhom, locBoPhan, locCuaToi,
}: Props) {
  const router = useRouter();
  const [moTao, setMoTao] = useState(false);
  const [xem, setXem] = useState<string | null>(null);
  const [, start] = useTransition();

  function doiLoc(next: Partial<{ trangThai: string; nhom: string; boPhan: string; cuaToi: boolean }>) {
    const q = new URLSearchParams();
    const tt = next.trangThai ?? locTrangThai;
    const nh = next.nhom ?? locNhom;
    const bp = next.boPhan ?? locBoPhan;
    const ct = next.cuaToi ?? locCuaToi;
    if (tt) q.set('tt', tt);
    if (nh) q.set('nhom', nh);
    if (bp) q.set('bp', bp);
    if (ct) q.set('toi', '1');
    const s = q.toString();
    start(() => router.push(`/f/cx${s ? `?${s}` : ''}`));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={locTrangThai} onChange={(e) => doiLoc({ trangThai: e.target.value })}
          aria-label="Lọc theo trạng thái"
          className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Mọi trạng thái</option>
          {TRANG_THAI_TICKET.map((t) => (
            <option key={t} value={t}>{NHAN_TICKET[t]}{dem[t] != null ? ` (${dem[t]})` : ''}</option>
          ))}
        </select>

        <select
          value={locNhom} onChange={(e) => doiLoc({ nhom: e.target.value })}
          aria-label="Lọc theo nhóm vấn đề"
          className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Mọi nhóm</option>
          {NHOM.map((n) => <option key={n.ma} value={n.ma}>{n.ten}</option>)}
        </select>

        <select
          value={locBoPhan} onChange={(e) => doiLoc({ boPhan: e.target.value })}
          aria-label="Lọc theo bộ phận"
          className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Mọi bộ phận</option>
          {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
        </select>

        {boPhanMinh && (
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox" checked={locCuaToi}
              onChange={(e) => doiLoc({ cuaToi: e.target.checked })}
            />
            Việc của {nhanBoPhan(boPhanMinh)}
          </label>
        )}

        <span className="ml-auto text-sm text-muted-foreground">{ticket.length} ticket</span>
        <Button type="button" size="sm" onClick={() => setMoTao(true)}>Tạo ticket</Button>
      </div>

      {ticket.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Không có ticket nào khớp bộ lọc.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mã</th>
                <th className="px-3 py-2 font-medium">Vấn đề</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Bộ phận</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Tạo</th>
              </tr>
            </thead>
            <tbody>
              {ticket.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setXem(t.id)}
                  className="cursor-pointer border-t border-border hover:bg-muted/50"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {t.maTicket}
                    {t.nguon === 'lark' && (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">lark</span>
                    )}
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <span className="block truncate">{t.tieuDe}</span>
                    {(t.store || t.soDong > 0) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.store}
                        {t.soDong > 0 && ` · ${t.soDong} dòng đơn`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{nhanLoai(t.nhom, t.loai)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {t.phanViec.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : t.phanViec.map((p) => (
                        <span
                          key={p.boPhan}
                          title={NHAN_VIEC[p.trangThai as 'dang_xu_ly'] ?? p.trangThai}
                          className={
                            'rounded-full px-2 py-0.5 text-xs '
                            + (p.trangThai === 'da_xu_ly'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : p.trangThai === 'chua_du_thong_tin'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-muted text-muted-foreground')
                          }
                        >
                          {nhanBoPhan(p.boPhan)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {NHAN_TICKET[t.trangThai as 'moi'] ?? t.trangThai}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {t.taoLuc.toLocaleDateString('vi-VN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={moTao} onOpenChange={setMoTao}>
        <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-[760px]">
          <DialogTitle className="text-base font-semibold">Tạo ticket</DialogTitle>
          <TaoTicket
            boPhanMinh={boPhanMinh} toanQuyen={toanQuyen}
            onXong={() => { setMoTao(false); router.refresh(); }}
          />
        </DialogContent>
      </Dialog>

      <ModalChiTiet
        ticketId={xem} boPhanMinh={boPhanMinh} toanQuyen={toanQuyen}
        onDong={() => setXem(null)} onDoi={() => router.refresh()}
      />
    </div>
  );
}
