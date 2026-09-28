'use client';

import { useEffect, useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  NHAN_TRANG_THAI, capBaoDong, conBaoNhieuNgay, nhanCong, nhanLyDo,
} from '@/features/dispute/chuan-hoa';
import { chiTietDispute } from '@/features/dispute/queries';
import { suaPhanCx, themGhiChu } from '@/features/dispute/actions';
import type { ChiTietDispute } from '@/features/dispute/types';
import { DaiLienQuan } from '@/components/cx/DaiLienQuan';

/**
 * Chi tiết một ca tranh chấp.
 *
 * KHÔNG thêm `relative` vào DialogContent: bản gốc là `fixed top-1/2 left-1/2
 * -translate-*`, mà `cn()` dùng twMerge nên `relative` ĐÈ MẤT `fixed`.
 */
export function ModalDispute({
  id, coQuyenGhi, onDong, onDoi,
}: { id: string | null; coQuyenGhi: boolean; onDong: () => void; onDoi: () => void }) {
  return (
    <Dialog open={id !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        {id && <NoiDung key={id} id={id} coQuyenGhi={coQuyenGhi} onDoi={onDoi} />}
      </DialogContent>
    </Dialog>
  );
}

function NoiDung({ id, coQuyenGhi, onDoi }: { id: string; coQuyenGhi: boolean; onDoi: () => void }) {
  const [d, setD] = useState<ChiTietDispute | null>(null);
  const [daTai, setDaTai] = useState(false);
  const [loiTai, setLoiTai] = useState(false);
  const [ghi, setGhi] = useState('');
  const [maHoSo, setMaHoSo] = useState('');
  const [phi, setPhi] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let huy = false;
    void (async () => {
      const r = await chiTietDispute(id).catch((e) => {
        console.error('[dispute] tải chi tiết lỗi:', e);
        return undefined;
      });
      if (huy) return;
      if (r === undefined) setLoiTai(true);
      else if (r) { setD(r); setMaHoSo(r.maHoSo ?? ''); setPhi(r.phiDispute ?? ''); }
      setDaTai(true);
    })();
    return () => { huy = true; };
  }, [id]);

  async function taiLai() {
    const r = await chiTietDispute(id).catch(() => undefined);
    if (r) setD(r);
  }

  if (!daTai) return <div className="p-6 text-sm text-muted-foreground">Đang tải…</div>;
  if (loiTai || !d) {
    return (
      <div className="p-6">
        <DialogTitle className="text-base font-semibold">Không tải được ca tranh chấp</DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">Đóng modal rồi mở lại; vẫn lỗi thì báo kỹ thuật.</p>
      </div>
    );
  }

  const conLai = conBaoNhieuNgay(d.hanNop, new Date());
  const cap = capBaoDong(conLai, d.daNopLuc != null);
  const tuShopify = d.nguon === 'shopify';

  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <DialogTitle className="text-base font-semibold tabular-nums">
            {d.tienTe} {Number(d.soTien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}
          </DialogTitle>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {NHAN_TRANG_THAI[d.trangThai as 'lost'] ?? d.trangThai}
          </span>
          {tuShopify && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">
              từ Shopify — chỉ đọc
            </span>
          )}
          {cap === 'qua_han' && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
              quá hạn nộp bằng chứng
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {d.store} · {nhanCong(d.congThanhToan)} · {d.loai === 'inquiry' ? 'yêu cầu làm rõ' : 'chargeback'}
          {d.maDon && ` · ${d.maDon}`}
          {d.khachEmail && ` · ${d.khachEmail}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <DaiLienQuan maDon={d.maDon} boQua="tranh_chap" />

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {[
            ['Lý do', `${nhanLyDo(d.lyDo)}${d.lyDoMang ? ` (mã ${d.lyDoMang})` : ''}`],
            ['Ngày mở', d.moLuc?.toLocaleDateString('vi-VN') ?? '—'],
            ['Hạn nộp bằng chứng', d.hanNop
              ? `${d.hanNop.toLocaleDateString('vi-VN')}${conLai != null ? ` (${conLai < 0 ? `quá ${-conLai} ngày` : `còn ${conLai} ngày`})` : ''}`
              : '—'],
            ['Đã nộp bằng chứng', d.daNopLuc?.toLocaleDateString('vi-VN') ?? 'chưa'],
            ['Ngày chốt', d.chotLuc?.toLocaleDateString('vi-VN') ?? '—'],
            ['Phí dispute', d.phiDispute ? `${d.tienTe} ${d.phiDispute}` : '—'],
            ['Mã hồ sơ CX', d.maHoSo ?? '—'],
            ['Đồng bộ lần cuối', d.dongBoLuc?.toLocaleString('vi-VN') ?? '—'],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-2 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {d.maDon && !d.coDonTrongHeThong && (
          <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Đơn {d.maDon} chưa có trong hệ thống nên không mở được chi tiết đơn — phần lớn
            là đơn từ 2023 chưa đồng bộ.
          </p>
        )}

        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            Diễn biến ({d.ghiChu.length})
          </h3>
          {d.ghiChu.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có ghi chú nào.</p>
          ) : (
            <ul className="space-y-2">
              {d.ghiChu.map((g) => (
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
          <textarea
            value={ghi} onChange={(e) => setGhi(e.target.value)} rows={2}
            placeholder="Thêm diễn biến — ghi rồi không sửa được"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={maHoSo} onChange={(e) => setMaHoSo(e.target.value)}
              placeholder="Mã hồ sơ CX"
              className="h-9 w-40 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
            <input
              value={phi} onChange={(e) => setPhi(e.target.value)}
              placeholder="Phí dispute" inputMode="decimal"
              className="h-9 w-32 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
            <Button
              type="button" variant="outline" size="sm" disabled={pending}
              onClick={() => start(async () => {
                setLoi(null);
                const r = await suaPhanCx(id, maHoSo, phi);
                if (!r.ok) { setLoi(r.loi ?? 'Lưu thất bại.'); return; }
                await taiLai(); onDoi();
              })}
            >
              Lưu mã & phí
            </Button>
            <Button
              type="button" size="sm" disabled={pending} className="ml-auto"
              onClick={() => start(async () => {
                setLoi(null);
                const r = await themGhiChu(id, ghi);
                if (!r.ok) { setLoi(r.loi ?? 'Thêm ghi chú thất bại.'); return; }
                setGhi(''); await taiLai(); onDoi();
              })}
            >
              {pending ? 'Đang lưu…' : 'Thêm ghi chú'}
            </Button>
          </div>
          {tuShopify && (
            <p className="text-xs text-muted-foreground">
              Trạng thái, số tiền và hạn nộp do Shopify quyết — lượt đồng bộ sau sẽ ghi lại,
              nên ở đây chỉ sửa được mã hồ sơ, phí và ghi chú.
            </p>
          )}
        </div>
      )}
    </>
  );
}
