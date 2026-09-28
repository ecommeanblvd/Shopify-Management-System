'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BO_PHAN, nhanBoPhan, nhanLoai } from '@/features/cx-ticket/phan-loai';
import { NHAN_TICKET, NHAN_VIEC, boPhanConTac } from '@/features/cx-ticket/trang-thai';
import { chiTietTicket } from '@/features/cx-ticket/queries';
import { doiTrangThaiTicket, ghiPhanViec } from '@/features/cx-ticket/actions';
import type { ChiTietTicket } from '@/features/cx-ticket/types';
import { DaiLienQuan } from '@/components/cx/DaiLienQuan';

/**
 * Modal chi tiết ticket.
 *
 * KHÔNG thêm `relative` vào DialogContent: bản gốc là `fixed top-1/2 left-1/2
 * -translate-*`, mà `cn()` dùng twMerge nên `relative` ĐÈ MẤT `fixed` và modal
 * tụt xuống cuối luồng trang.
 */
export function ModalChiTiet({
  ticketId, boPhanMinh, toanQuyen, onDong, onDoi,
}: {
  ticketId: string | null; boPhanMinh: string | null; toanQuyen: boolean;
  onDong: () => void; onDoi: () => void;
}) {
  return (
    <Dialog open={ticketId !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        {/* `key` theo ticket: đổi ticket là remount, state bên trong tự khởi tạo lại. */}
        {ticketId && (
          <NoiDung key={ticketId} ticketId={ticketId} boPhanMinh={boPhanMinh}
            toanQuyen={toanQuyen} onDoi={onDoi} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoiDung({
  ticketId, boPhanMinh, toanQuyen, onDoi,
}: { ticketId: string; boPhanMinh: string | null; toanQuyen: boolean; onDoi: () => void }) {
  const [t, setT] = useState<ChiTietTicket | null>(null);
  const [daTai, setDaTai] = useState(false);
  const [loiTai, setLoiTai] = useState(false);
  const [boPhanGhi, setBoPhanGhi] = useState<string>(boPhanMinh ?? BO_PHAN[0].ma);
  const [trangThaiGhi, setTrangThaiGhi] = useState('dang_xu_ly');
  const [noiDung, setNoiDung] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function tai() {
    try {
      const r = await chiTietTicket(ticketId);
      setT(r);
      setLoiTai(false);
    } catch (e) {
      console.error('[cx-ticket] tải chi tiết lỗi:', e);
      setLoiTai(true);
    } finally {
      setDaTai(true);
    }
  }

  useEffect(() => {
    let huy = false;
    void (async () => {
      const r = await chiTietTicket(ticketId).catch((e) => {
        console.error('[cx-ticket] tải chi tiết lỗi:', e);
        return undefined;
      });
      if (huy) return;
      if (r === undefined) setLoiTai(true); else setT(r);
      setDaTai(true);
    })();
    return () => { huy = true; };
  }, [ticketId]);

  const chiDoc = t?.nguon === 'lark' || t?.trangThai === 'xong';

  function ghi() {
    start(async () => {
      setLoi(null);
      const r = await ghiPhanViec(ticketId, boPhanGhi, trangThaiGhi, noiDung);
      if (!r.ok) { setLoi(r.loi ?? 'Ghi thất bại.'); return; }
      setNoiDung('');
      await tai();
      onDoi();
    });
  }

  function doiTrangThai(den: string) {
    start(async () => {
      setLoi(null);
      const r = await doiTrangThaiTicket(ticketId, den);
      if (!r.ok) { setLoi(r.loi ?? 'Đổi trạng thái thất bại.'); return; }
      await tai();
      onDoi();
    });
  }

  function dong() {
    const conTac = boPhanConTac(t?.phanViecDayDu ?? []);
    if (conTac.length > 0) {
      // CEO 25/09: cảnh báo cho người dùng biết, KHÔNG chặn cứng.
      toast.warning(
        `Còn ${conTac.length} bộ phận chưa xử lý xong: ${conTac.map(nhanBoPhan).join(', ')}.`,
        { duration: 5000 },
      );
    }
    doiTrangThai('xong');
  }

  if (!daTai) {
    return <div className="p-6 text-sm text-muted-foreground">Đang tải…</div>;
  }
  if (loiTai || !t) {
    return (
      <div className="p-6">
        <DialogTitle className="text-base font-semibold">Không tải được ticket</DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Thử đóng modal và mở lại. Nếu vẫn lỗi thì báo kỹ thuật.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <DialogTitle className="text-base font-semibold">{t.tieuDe}</DialogTitle>
          <span className="font-mono text-xs text-muted-foreground">{t.maTicket}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{NHAN_TICKET[t.trangThai as 'moi'] ?? t.trangThai}</span>
          {t.nguon === 'lark' && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">
              hồ sơ Lark — chỉ đọc
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {nhanLoai(t.nhom, t.loai)} · {nhanBoPhan(t.boPhanNeu)} nêu
          {t.store && ` · ${t.store}`}
          {t.khachEmail && ` · ${t.khachEmail}`}
          {t.hanXuLy && ` · hạn ${t.hanXuLy}`}
          {t.maTicketCs && ` · Intercom ${t.maTicketCs}`}
          {` · ${t.taoLuc.toLocaleString('vi-VN')}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <DaiLienQuan maDon={t.dong[0]?.maDon ?? null} boQua="ticket" />

        {t.dong.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              Đơn liên quan ({t.dong.length})
            </h3>
            <ul className="space-y-1">
              {t.dong.map((d) => (
                <li key={d.lineId} className="rounded-lg border border-border px-3 py-2 text-sm">
                  {d.maDon} · <span className="font-mono text-xs">{d.sku}</span>
                  <span className="text-muted-foreground"> — {d.tenSanPham}{d.bienThe && ` / ${d.bienThe}`} × {d.soLuong}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Phần việc từng bộ phận</h3>
          {t.phanViecDayDu.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa gán bộ phận nào.</p>
          ) : (
            <ul className="space-y-1">
              {t.phanViecDayDu.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="font-medium">{nhanBoPhan(p.boPhan)}</span>
                  <span className={
                    'rounded-full px-2 py-0.5 text-xs '
                    + (p.trangThai === 'da_xu_ly'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : p.trangThai === 'chua_du_thong_tin'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'bg-muted text-muted-foreground')
                  }>
                    {NHAN_VIEC[p.trangThai as 'dang_xu_ly'] ?? p.trangThai}
                  </span>
                  {p.tenNguoiPhuTrach && (
                    <span className="text-xs text-muted-foreground">{p.tenNguoiPhuTrach}</span>
                  )}
                  {p.xongLuc && (
                    <span className="text-xs text-muted-foreground">
                      xong {p.xongLuc.toLocaleDateString('vi-VN')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            Diễn biến ({t.ghiChu.length})
          </h3>
          {t.ghiChu.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có ghi chú nào.</p>
          ) : (
            <ul className="space-y-2">
              {t.ghiChu.map((g) => (
                <li key={g.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{nhanBoPhan(g.boPhan)}</span>
                    {g.tenNguoiGhi && ` · ${g.tenNguoiGhi}`}
                    {g.ghiHo && ' · ghi hộ'}
                    {` · ${g.taoLuc.toLocaleString('vi-VN')}`}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{g.noiDung}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!chiDoc && (
        <div className="shrink-0 space-y-3 border-t border-border p-4">
          {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}
          <textarea
            value={noiDung} onChange={(e) => setNoiDung(e.target.value)} rows={2}
            placeholder="Cập nhật của bộ phận — ghi xong không sửa được, nên ghi rõ ràng"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={boPhanGhi} onChange={(e) => setBoPhanGhi(e.target.value)}
              disabled={!toanQuyen}
              aria-label="Ghi cho bộ phận"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
            </select>
            <select
              value={trangThaiGhi} onChange={(e) => setTrangThaiGhi(e.target.value)}
              aria-label="Trạng thái phần việc"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              {Object.entries(NHAN_VIEC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button type="button" size="sm" onClick={ghi} disabled={pending}>
              {pending ? 'Đang lưu…' : 'Ghi cập nhật'}
            </Button>
            {toanQuyen && (
              <Button type="button" variant="outline" size="sm" onClick={dong} disabled={pending}>
                Đóng ticket
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
