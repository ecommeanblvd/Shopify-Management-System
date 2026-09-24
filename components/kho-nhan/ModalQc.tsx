'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { layDuLieuQc } from '@/features/kho-nhan/shopify-qc';
import { qcDat } from '@/features/kho-nhan/qc-actions';
import type { DangKiem, DongQc } from '@/features/kho-nhan/types';
import { KhoiLoi } from './KhoiLoi';

/**
 * Modal QC toàn màn hình (CEO 24/09: "ảnh hiện to full height modal gần bằng cả
 * màn hình, có bấm sang 2 bên để đổi ảnh, bên phải là các attributes").
 *
 * KHÔNG thêm `relative` vào DialogContent: bản gốc là `fixed top-1/2 left-1/2
 * -translate-*`, mà `cn()` dùng twMerge nên `relative` ĐÈ MẤT `fixed` và modal
 * tụt xuống cuối luồng trang (đã mắc đúng lỗi này 24/09 ở màn KOL).
 */
export function ModalQc({
  chiec, coStorage, onDong, onXong,
}: {
  chiec: DangKiem | null; coStorage: boolean; onDong: () => void; onXong: () => void;
}) {
  return (
    <Dialog open={chiec !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex h-[94vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[1400px]">
        {/* `key` theo chiếc: đổi chiếc là remount, mọi state bên trong tự khởi tạo
            lại. Nhờ vậy effect KHÔNG phải gọi setState đồng bộ để dọn state cũ —
            thứ gây render dây chuyền và bị eslint chặn. */}
        {chiec && <NoiDungQc key={chiec.id} chiec={chiec} coStorage={coStorage} onXong={onXong} />}
      </DialogContent>
    </Dialog>
  );
}

function NoiDungQc({
  chiec, coStorage, onXong,
}: {
  chiec: DangKiem; coStorage: boolean; onXong: () => void;
}) {
  const [dong, setDong] = useState<DongQc | null>(null);
  /** Chỉ bật khi lượt gọi Shopify KẾT THÚC. `dangTai` là giá trị SUY RA từ nó —
   *  lưu `dangTai` thành state buộc effect phải setState đồng bộ khi thiếu khoá,
   *  thứ gây render dây chuyền. */
  const [daTai, setDaTai] = useState(false);
  const [loiTai, setLoiTai] = useState(false);
  const [iAnh, setIAnh] = useState(0);
  const [moKhoiLoi, setMoKhoiLoi] = useState(false);
  const [kho, setKho] = useState<string>(WAREHOUSE_PRIORITY[0]!);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Thiếu khoá thì không gọi Shopify được — SUY RA, không setState trong effect. */
  const thieuKhoa = !chiec.storeId || !chiec.shopifyOrderId;
  const loiShopify = loiTai || thieuKhoa;

  const dangTai = !thieuKhoa && !daTai;

  const { storeId, shopifyOrderId, sku } = chiec;
  useEffect(() => {
    // Thiếu khoá thì KHÔNG gọi gì và KHÔNG setState — `dangTai` đã suy ra false.
    if (!storeId || !shopifyOrderId) return;
    let huy = false;
    void (async () => {
      const r = await layDuLieuQc(storeId, shopifyOrderId);
      if (huy) return;
      if (!r) { setLoiTai(true); setDaTai(true); return; }
      // Khớp theo SKU — một đơn nhiều dòng, phải lấy đúng dòng của chiếc này.
      setDong(r.dong.find((d) => d.sku === sku) ?? null);
      setDaTai(true);
    })();
    return () => { huy = true; };
  }, [storeId, shopifyOrderId, sku]);

  const anh = dong?.anh ?? [];
  const soAnh = anh.length;
  const doiAnh = useCallback((b: number) => {
    if (soAnh === 0) return;
    setIAnh((i) => (i + b + soAnh) % soAnh);
  }, [soAnh]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); doiAnh(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); doiAnh(1); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [doiAnh]);

  const dat = () =>
    start(async () => {
      setLoi(null);
      const r = await qcDat(chiec.id, kho);
      if (!r.ok) { setLoi(r.loi ?? 'QC thất bại.'); return; }
      onXong();
    });

  return (
    <>
      <div className="flex shrink-0 items-baseline gap-3 border-b border-border px-5 py-3">
        <DialogTitle className="text-base font-semibold">Kiểm hàng</DialogTitle>
        <span className="font-mono text-xs text-muted-foreground">{chiec.unitCode}</span>
        {chiec.maDon && <span className="text-xs text-muted-foreground">· {chiec.maDon}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted">
          {dangTai ? (
            <p className="text-sm text-muted-foreground">Đang tải ảnh…</p>
          ) : soAnh === 0 ? (
            <p className="px-6 text-center text-sm text-muted-foreground">
              {loiShopify
                ? 'Không lấy được ảnh và thuộc tính từ Shopify — vẫn kiểm và ghi kết quả bình thường.'
                : 'Sản phẩm này chưa có ảnh trên Shopify.'}
            </p>
          ) : (
            <>
              <Image
                src={anh[iAnh]!}
                alt={`Ảnh ${iAnh + 1}/${soAnh} của ${chiec.tenSanPham ?? chiec.sku ?? 'sản phẩm'}`}
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-contain"
                unoptimized
              />
              {soAnh > 1 && (
                <>
                  <button
                    type="button" onClick={() => doiAnh(-1)} aria-label="Ảnh trước"
                    className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 text-xl hover:bg-background"
                  >‹</button>
                  <button
                    type="button" onClick={() => doiAnh(1)} aria-label="Ảnh sau"
                    className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 text-xl hover:bg-background"
                  >›</button>
                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums">
                    {iAnh + 1}/{soAnh}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-border p-4 md:w-[420px] md:border-l md:border-t-0">
          <p className="text-sm font-semibold">{chiec.tenSanPham ?? chiec.sku}</p>
          {chiec.tenBienThe && <p className="text-sm text-muted-foreground">{chiec.tenBienThe}</p>}
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{chiec.sku}</p>

          <dl className="mt-4 space-y-1.5">
            {(dong?.thuocTinh ?? []).map((t) => (
              <div key={t.nhan} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 text-sm">
                <dt className="text-muted-foreground">{t.nhan}</dt>
                <dd>{t.giaTri}</dd>
              </div>
            ))}
          </dl>

          {dong && dong.thuocTinh.length === 0 && !loiShopify && (
            <p className="mt-4 text-sm text-muted-foreground">Sản phẩm này chưa khai thuộc tính trên Shopify.</p>
          )}
          {dong && dong.soBiCat > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              còn {dong.soBiCat} thuộc tính khác không hiển thị
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-t border-border p-4">
        {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}
        {moKhoiLoi ? (
          <KhoiLoi itemId={chiec.id} coStorage={coStorage} onXong={onXong} onHuy={() => setMoKhoiLoi(false)} />
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Nhập kho</span>
              <select
                value={kho} onChange={(e) => setKho(e.target.value)} aria-label="Kho nhập vào"
                className="h-10 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
              >
                {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <Button type="button" variant="destructive" size="lg" onClick={() => setMoKhoiLoi(true)}>
              Không đạt
            </Button>
            <Button type="button" size="lg" onClick={dat} disabled={pending}>
              {pending ? 'Đang lưu…' : 'Đạt — nhập kho'}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
