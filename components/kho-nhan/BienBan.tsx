'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { chiecChoTraBrand, danhDauDaLapBienBan, type ChiecLoi } from '@/features/kho-nhan/bien-ban';

function ngayHomNay(): string { return new Date().toISOString().slice(0, 10); }
function ngayTruoc(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Biên bản trả brand — gom chiếc QC không đạt theo brand để in gửi lại.
 *
 * In bằng `window.print()` + CSS `@media print`, cùng cách màn in tem đang làm;
 * không thêm thư viện PDF.
 */
export function BienBan({ brands }: { brands: string[] }) {
  const [brand, setBrand] = useState(brands[0] ?? '');
  const [tuNgay, setTuNgay] = useState(ngayTruoc(30));
  const [denNgay, setDenNgay] = useState(ngayHomNay());
  const [ds, setDs] = useState<ChiecLoi[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [daLap, setDaLap] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const maBienBan = `BB-${denNgay.replace(/-/g, '')}-${(brand || 'BRAND').replace(/\s+/g, '-').toUpperCase()}`;

  const xem = () =>
    start(async () => {
      setLoi(null); setDaLap(null);
      if (!brand) { setLoi('Chọn brand trước.'); return; }
      try {
        // denNgay tới hết ngày, không phải 00:00 — thiếu chỗ này thì chiếc kiểm
        // trong chính ngày cuối bị rơi ra ngoài biên bản.
        const r = await chiecChoTraBrand(brand, new Date(`${tuNgay}T00:00:00`), new Date(`${denNgay}T23:59:59`));
        setDs(r);
      } catch {
        setLoi('Không tải được danh sách, thử lại.');
      }
    });

  const chotVaIn = () =>
    start(async () => {
      if (!ds || ds.length === 0) return;
      const r = await danhDauDaLapBienBan(ds.map((x) => x.itemId), maBienBan);
      setDaLap(`Đã chốt ${r.soDanhDau} chiếc vào biên bản ${maBienBan}.`);
      window.print();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Brand</span>
          <select
            value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand"
            className="h-10 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {brands.length === 0 && <option value="">(chưa có brand nào có hàng chờ trả)</option>}
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Từ ngày</span>
          <input type="date" value={tuNgay} onChange={(e) => setTuNgay(e.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Đến ngày</span>
          <input type="date" value={denNgay} onChange={(e) => setDenNgay(e.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-2 text-sm" />
        </label>
        <Button type="button" size="lg" onClick={xem} disabled={pending || !brand}>
          {pending ? 'Đang tải…' : 'Xem danh sách'}
        </Button>
        {ds && ds.length > 0 && (
          <Button type="button" size="lg" variant="outline" onClick={chotVaIn} disabled={pending}>
            Chốt &amp; in biên bản
          </Button>
        )}
      </div>

      {loi && <p className="text-sm text-destructive print:hidden">{loi}</p>}
      {daLap && <p className="text-sm text-emerald-600 dark:text-emerald-400 print:hidden">{daLap}</p>}

      {ds && (
        ds.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground print:hidden">
            Không có chiếc nào chờ trả brand trong khoảng này.
          </p>
        ) : (
          <article className="space-y-4 rounded-lg border border-border p-5 print:border-0 print:p-0">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold">Biên bản hàng không đạt kiểm</h2>
              <p className="text-sm text-muted-foreground">
                Brand <strong className="text-foreground">{brand}</strong> · {ds.length} chiếc ·
                {' '}từ {tuNgay} đến {denNgay}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{maBienBan}</p>
            </header>

            <ol className="space-y-4">
              {ds.map((c, i) => (
                <li key={c.itemId} className="break-inside-avoid border-t border-border pt-3">
                  <p className="text-sm font-medium">
                    {i + 1}. {c.tenSanPham ?? c.sku}
                    {c.tenBienThe && <span className="text-muted-foreground"> — {c.tenBienThe}</span>}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.unitCode} · {c.sku}{c.maDon && ` · ${c.maDon}`}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {c.loi.map((l, j) => (
                      <li key={j} className="flex flex-wrap items-start gap-3 text-sm">
                        <span className="font-medium">{l.lyDo}</span>
                        {l.ghiChu && <span className="text-muted-foreground">{l.ghiChu}</span>}
                        {l.anhUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.anhUrl} alt={`Ảnh lỗi ${l.lyDo}`}
                            className="h-28 w-28 rounded border border-border object-cover" />
                        )}
                      </li>
                    ))}
                    {c.loi.length === 0 && (
                      <li className="text-sm text-muted-foreground">(chưa ghi chỗ lỗi nào)</li>
                    )}
                  </ul>
                </li>
              ))}
            </ol>
          </article>
        )
      )}
    </div>
  );
}
