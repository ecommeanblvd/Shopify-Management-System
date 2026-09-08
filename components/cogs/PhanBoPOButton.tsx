'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { phanBoPOAction } from '@/features/cogs/actions';

type KetQua = Awaited<ReturnType<typeof phanBoPOAction>>;
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Phân bổ hàng PO xuống dòng đơn không có trên bảng kê (FIFO theo kỳ PO ≤ tháng đặt). */
export function PhanBoPOButton({ brands }: { brands: Array<{ slug: string; displayName: string }> }) {
  const [brand, setBrand] = useState(brands.find((b) => b.slug === 'denio')?.slug ?? brands[0]?.slug ?? '');
  const [kq, setKq] = useState<KetQua | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chay = (dryRun: boolean) => start(async () => {
    setLoi(null);
    try { setKq(await phanBoPOAction(brand, dryRun)); } catch (e) { setLoi(e instanceof Error ? e.message : String(e)); }
  });
  const nhomKhong = kq ? [...kq.khong.reduce((m, k) => m.set(k.lyDo, (m.get(k.lyDo) ?? 0) + 1), new Map<string, number>()).entries()] : [];
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Brand
          <select className="mt-1 block rounded border px-2 py-1" value={brand} onChange={(e) => setBrand(e.target.value)}>
            {brands.map((b) => <option key={b.slug} value={b.slug}>{b.displayName}</option>)}
          </select>
        </label>
        <Button variant="outline" onClick={() => chay(true)} disabled={pending || !brand}>Xem trước</Button>
        <Button onClick={() => chay(false)} disabled={pending || !brand}>Phân bổ PO → đơn</Button>
        {pending && <span className="text-sm text-muted-foreground">Đang tính…</span>}
        {loi && <span className="text-sm text-red-600">{loi}</span>}
      </div>
      {kq && (
        <div className="space-y-2 text-sm">
          <div>
            {kq.dryRun ? 'Xem trước' : 'Đã ghi'}: <b>{kq.daPhanBo}</b>/{kq.dongXet} dòng đơn không có trên bảng kê được lấy từ PO · tổng giá vốn <b>{vnd(kq.tongVnd)} ₫</b>
          </div>
          {kq.theoPO.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {kq.theoPO.map((p) => <span key={p.refCode} className="rounded bg-muted px-1.5 py-0.5 tabular-nums">{p.refCode}: {p.qty} chiếc · {vnd(p.vnd)}</span>)}
            </div>
          )}
          {kq.khong.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
                {kq.khong.length} dòng chưa phân bổ được — {nhomKhong.map(([l, n]) => `${l}: ${n}`).join(' · ')}
              </summary>
              <ul className="mt-1 max-h-64 overflow-auto space-y-0.5 font-mono">
                {kq.khong.map((k, i) => <li key={i}>{k.thangDat} {k.maDon} {k.sku ?? '—'} <span className="text-muted-foreground">({k.lyDo})</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </CardContent></Card>
  );
}
