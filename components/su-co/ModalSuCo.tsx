'use client';

import { useEffect, useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BO_PHAN, nhanBoPhan } from '@/features/to-chuc/bo-phan';
import {
  LOAI_CHI_PHI, NHAN_TRANG_THAI, TRANG_THAI, nhanLoaiChiPhi, nhanNguyenNhan,
} from '@/features/su-co/phan-loai';
import { chuoiTongTien, gomTheoTienTe } from '@/features/dispute/tong-tien';
import { chiTietSuCo } from '@/features/su-co/queries';
import {
  daXemLai, doiBoPhanChinh, doiTrangThaiSuCo, themChiPhi, themGhiChuSuCo, xoaChiPhi,
} from '@/features/su-co/actions';
import type { ChiTietSuCo } from '@/features/su-co/types';
import { DaiLienQuan } from '@/components/cx/DaiLienQuan';

/**
 * KHÔNG thêm `relative` vào DialogContent: bản gốc là `fixed top-1/2 left-1/2
 * -translate-*`, mà `cn()` dùng twMerge nên `relative` ĐÈ MẤT `fixed`.
 */
export function ModalSuCo({
  id, coQuyenGhi, onDong, onDoi,
}: { id: string | null; coQuyenGhi: boolean; onDong: () => void; onDoi: () => void }) {
  return (
    <Dialog open={id !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]">
        {id && <NoiDung key={id} id={id} coQuyenGhi={coQuyenGhi} onDoi={onDoi} />}
      </DialogContent>
    </Dialog>
  );
}

function NoiDung({ id, coQuyenGhi, onDoi }: { id: string; coQuyenGhi: boolean; onDoi: () => void }) {
  const [s, setS] = useState<ChiTietSuCo | null>(null);
  const [daTai, setDaTai] = useState(false);
  const [loiTai, setLoiTai] = useState(false);
  const [ghi, setGhi] = useState('');
  const [cpLoai, setCpLoai] = useState(LOAI_CHI_PHI[0]!.ma);
  const [cpTien, setCpTien] = useState('');
  const [cpTienTe, setCpTienTe] = useState('USD');
  const [cpBoPhan, setCpBoPhan] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [anhTo, setAnhTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let huy = false;
    void (async () => {
      const r = await chiTietSuCo(id).catch((e) => {
        console.error('[su-co] tải chi tiết lỗi:', e);
        return undefined;
      });
      if (huy) return;
      if (r === undefined) setLoiTai(true); else if (r) setS(r);
      setDaTai(true);
    })();
    return () => { huy = true; };
  }, [id]);

  async function taiLai() {
    const r = await chiTietSuCo(id).catch(() => undefined);
    if (r) setS(r);
  }

  function chay(fn: () => Promise<{ ok: boolean; loi?: string }>, sau?: () => void) {
    start(async () => {
      setLoi(null);
      const r = await fn();
      if (!r.ok) { setLoi(r.loi ?? 'Thao tác thất bại.'); return; }
      sau?.();
      await taiLai();
      onDoi();
    });
  }

  if (!daTai) return <div className="p-6 text-sm text-muted-foreground">Đang tải…</div>;
  if (loiTai || !s) {
    return (
      <div className="p-6">
        <DialogTitle className="text-base font-semibold">Không tải được sự cố</DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">Đóng modal rồi mở lại; vẫn lỗi thì báo kỹ thuật.</p>
      </div>
    );
  }

  const tong = gomTheoTienTe(s.chiPhi.map((c) => ({ soTien: c.soTien, tienTe: c.tienTe })));

  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <DialogTitle className="text-base font-semibold">{nhanNguyenNhan(s.nguyenNhan)}</DialogTitle>
          <span className="font-mono text-xs text-muted-foreground">{s.maSuCo}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {NHAN_TRANG_THAI[s.trangThai as 'mo'] ?? s.trangThai}
          </span>
          {s.nguonLark && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">
              từ Lark
            </span>
          )}
          {s.canXemLai && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
              cần xem lại
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {s.ngayBao}
          {s.store && ` · ${s.store}`}
          {s.maDon && ` · ${s.maDon}`}
          {s.maTicketCs && ` · Intercom ${s.maTicketCs}`}
          {s.maGiamGia && ` · mã giảm giá ${s.maGiamGia}`}
          {` · chịu chính: ${nhanBoPhan(s.boPhanChinh)}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <DaiLienQuan maDon={s.maDon} boQua="su_co" />

        {s.moTa && <p className="whitespace-pre-wrap text-sm">{s.moTa}</p>}

        {s.maDon && !s.coDonTrongHeThong && (
          <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Đơn {s.maDon} chưa có trong hệ thống nên không mở được chi tiết đơn.
          </p>
        )}

        <section>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
              Khoản chi phí ({s.chiPhi.length})
            </h3>
            <span className="text-sm font-medium tabular-nums">{chuoiTongTien(tong)}</span>
          </div>
          {s.chiPhi.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa ghi khoản chi phí nào.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {s.chiPhi.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{nhanLoaiChiPhi(c.loai)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.boPhan
                      ? nhanBoPhan(c.boPhan)
                      : `${nhanBoPhan(s.boPhanChinh)} (theo sự cố)`}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {c.tienTe} {Number(c.soTien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}
                  </span>
                  {coQuyenGhi && (
                    <button
                      type="button" disabled={pending}
                      onClick={() => chay(() => xoaChiPhi(c.id))}
                      className="shrink-0 cursor-pointer text-xs underline disabled:opacity-50"
                    >
                      xoá
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {s.anhUrls.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              Bằng chứng ({s.anhUrls.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {s.anhUrls.map((u, i) => (
                <button key={i} type="button" onClick={() => setAnhTo(u)} className="cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Bằng chứng ${i + 1}`}
                    className="max-h-24 rounded-md border border-border" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            Ghi chú ({s.ghiChu.length})
          </h3>
          {s.ghiChu.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có ghi chú nào.</p>
          ) : (
            <ul className="space-y-2">
              {s.ghiChu.map((g) => (
                <li key={g.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {g.tuLark ? 'từ Lark' : (g.tenNguoiGhi ?? 'không rõ')}
                    {` · ${g.taoLuc.toLocaleString('vi-VN')}`}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{g.noiDung}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {coQuyenGhi && (
        <div className="shrink-0 space-y-3 border-t border-border p-4">
          {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

          {/* Thêm khoản chi phí */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={cpLoai} onChange={(e) => setCpLoai(e.target.value)}
              aria-label="Loại chi phí"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              {LOAI_CHI_PHI.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
            </select>
            <input
              value={cpTien} onChange={(e) => setCpTien(e.target.value)}
              inputMode="decimal" placeholder="Số tiền" aria-label="Số tiền"
              className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
            <input
              value={cpTienTe} onChange={(e) => setCpTienTe(e.target.value.toUpperCase())}
              maxLength={3} aria-label="Đơn vị tiền"
              className="h-9 w-16 rounded-lg border border-input bg-background px-2.5 text-sm uppercase"
            />
            <select
              value={cpBoPhan} onChange={(e) => setCpBoPhan(e.target.value)}
              aria-label="Bộ phận chịu khoản này"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">theo sự cố</option>
              {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
            </select>
            <Button
              type="button" variant="outline" size="sm" disabled={pending}
              onClick={() => chay(
                () => themChiPhi(id, { loai: cpLoai, soTien: cpTien, tienTe: cpTienTe, boPhan: cpBoPhan || null }),
                () => setCpTien(''),
              )}
            >
              Thêm khoản
            </Button>
          </div>

          {/* Ghi chú + bộ phận chính + trạng thái */}
          <textarea
            value={ghi} onChange={(e) => setGhi(e.target.value)} rows={2}
            placeholder="Thêm ghi chú — ghi rồi không sửa được"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={s.boPhanChinh ?? ''}
              onChange={(e) => chay(() => doiBoPhanChinh(id, e.target.value || null))}
              aria-label="Bộ phận chịu chính"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">chưa ghi bộ phận</option>
              {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
            </select>
            <select
              value={s.trangThai}
              onChange={(e) => chay(() => doiTrangThaiSuCo(id, e.target.value))}
              aria-label="Trạng thái"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              {TRANG_THAI.map((t) => <option key={t} value={t}>{NHAN_TRANG_THAI[t]}</option>)}
            </select>
            {s.canXemLai && (
              <Button
                type="button" variant="outline" size="sm" disabled={pending}
                onClick={() => chay(() => daXemLai(id))}
              >
                Đã rà xong
              </Button>
            )}
            <Button
              type="button" size="sm" className="ml-auto" disabled={pending}
              onClick={() => chay(() => themGhiChuSuCo(id, ghi), () => setGhi(''))}
            >
              {pending ? 'Đang lưu…' : 'Thêm ghi chú'}
            </Button>
          </div>
        </div>
      )}

      {/* Ảnh to */}
      <Dialog open={anhTo !== null} onOpenChange={(v) => { if (!v) setAnhTo(null); }}>
        <DialogContent className="w-full sm:max-w-[95vw] p-2 sm:max-w-[1100px]">
          <DialogTitle className="sr-only">Ảnh bằng chứng</DialogTitle>
          {anhTo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={anhTo} alt="Bằng chứng" className="max-h-[88vh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
