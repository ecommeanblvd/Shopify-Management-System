'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TRANG_THAI, nhanKenh, nhanTrang, nhanTrangThai } from '@/features/danh-gia/phan-loai';
import { doiTrangThaiDanhGia, suaPhanCxDanhGia } from '@/features/danh-gia/actions';
import type { DongDanhGiaUI } from '@/features/danh-gia/types';
import { DaiLienQuan } from '@/components/cx/DaiLienQuan';

/**
 * Chi tiết một đánh giá.
 *
 * Nhận sẵn dữ liệu từ danh sách thay vì gọi lại máy chủ: bảng chỉ 500 dòng và đã
 * chở đủ mọi cột, nên một lượt gọi nữa chỉ làm modal mở chậm hơn.
 *
 * KHÔNG thêm `relative` vào DialogContent: bản gốc là `fixed top-1/2 left-1/2
 * -translate-*`, mà `cn()` dùng twMerge nên `relative` ĐÈ MẤT `fixed`.
 */
export function ModalDanhGia({
  id, danhGia, coQuyenGhi, onDong, onDoi,
}: {
  id: string | null;
  danhGia: DongDanhGiaUI | null;
  coQuyenGhi: boolean;
  onDong: () => void;
  onDoi: () => void;
}) {
  return (
    <Dialog open={id !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-[720px]">
        {danhGia
          ? <NoiDung key={danhGia.id} d={danhGia} coQuyenGhi={coQuyenGhi} onDoi={onDoi} />
          : <DialogTitle className="text-base font-semibold">Không tìm thấy đánh giá</DialogTitle>}
      </DialogContent>
    </Dialog>
  );
}

function NoiDung({
  d, coQuyenGhi, onDoi,
}: { d: DongDanhGiaUI; coQuyenGhi: boolean; onDoi: () => void }) {
  const [theoDoi, setTheoDoi] = useState(d.theoDoi ?? '');
  const [ghiChuCx, setGhiChuCx] = useState(d.ghiChuCx ?? '');
  const [vendor, setVendor] = useState(d.vendor ?? '');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function chay(fn: () => Promise<{ ok: boolean; loi?: string }>) {
    start(async () => {
      setLoi(null);
      const r = await fn();
      if (!r.ok) { setLoi(r.loi ?? 'Thao tác thất bại.'); return; }
      onDoi();
    });
  }

  const tệ = d.soSao <= 2;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <DialogTitle className="text-base font-semibold">
            <span className={tệ ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>
              {'★'.repeat(d.soSao)}
            </span>
            <span className="text-muted-foreground">{'☆'.repeat(5 - d.soSao)}</span>
            <span className="ml-2">{d.soSao} sao</span>
          </DialogTitle>
          <span className="font-mono text-xs text-muted-foreground">{d.maDanhGia}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{nhanTrangThai(d.trangThai)}</span>
          {d.nguonLark && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">
              từ Lark
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {d.ngay} · {nhanTrang(d.trang)} · {nhanKenh(d.kenhLienHe)}
          {d.quocGia && ` · ${d.quocGia}`}
          {d.maDon && ` · ${d.maDon}`}
          {d.store && ` · ${d.store}`}
          {d.khachTen && ` · ${d.khachTen}`}
          {d.khachEmail && ` · ${d.khachEmail}`}
        </p>
      </div>

      <DaiLienQuan maDon={d.maDon} boQua="danh_gia" />

      {d.maDon && !d.coDonTrongHeThong && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Đơn {d.maDon} chưa có trong hệ thống — phần lớn là đơn 2025 đầu chưa đồng bộ.
        </p>
      )}

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
          Nội dung khách viết
        </h3>
        <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-sm">
          {d.noiDung ?? <span className="text-muted-foreground">không có</span>}
        </p>
        {d.nguonLark && (
          <p className="mt-1 text-xs text-muted-foreground">
            Nội dung mang từ cột `Reason` của Lark — cột đó lẫn cả lời khách và ghi chú
            CX, nên nếu đây là ghi chú nội bộ thì chuyển sang ô bên dưới.
          </p>
        )}
      </section>

      {coQuyenGhi ? (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Ghi chú của CX</span>
            <textarea
              value={ghiChuCx} onChange={(e) => setGhiChuCx(e.target.value)} rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Đã xử lý thế nào</span>
            <textarea
              value={theoDoi} onChange={(e) => setTheoDoi(e.target.value)} rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={vendor} onChange={(e) => setVendor(e.target.value)}
              placeholder="Brand" aria-label="Brand"
              className="h-9 w-44 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
            <select
              value={d.trangThai ?? ''}
              onChange={(e) => chay(() => doiTrangThaiDanhGia(d.id, e.target.value || null))}
              aria-label="Trạng thái xử lý"
              className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">chưa ghi</option>
              {TRANG_THAI.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
            </select>
            <Button
              type="button" size="sm" className="ml-auto" disabled={pending}
              onClick={() => chay(() => suaPhanCxDanhGia(d.id, theoDoi, ghiChuCx, vendor))}
            >
              {pending ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {d.ghiChuCx && (
            <section>
              <h3 className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Ghi chú của CX</h3>
              <p className="whitespace-pre-wrap text-sm">{d.ghiChuCx}</p>
            </section>
          )}
          {d.theoDoi && (
            <section>
              <h3 className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Đã xử lý</h3>
              <p className="whitespace-pre-wrap text-sm">{d.theoDoi}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
