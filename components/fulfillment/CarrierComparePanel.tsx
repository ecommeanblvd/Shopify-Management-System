'use client';

import { useState, useTransition } from 'react';
import { getOrderCarrierComparison, assignOrderCarrier, type OrderCarrierComparison } from '@/features/shopify-orders/carrier-select-actions';

const num = (n: number) => Math.round(n).toLocaleString('vi-VN');
const vnd = (n?: number | null) => (typeof n === 'number' ? num(n) + '₫' : '—');

/**
 * Panel so sánh cước tất cả carrier cho 1 đơn → staff chọn carrier đi hàng.
 * Lazy load (bấm mới quote). MỌI số hiển thị quy về VND (carrier chi phí USD như
 * Aramex được nhân hệ số vndCost/carrierCost để đồng nhất). Rẻ nhất tô xanh + delta.
 */
export function CarrierComparePanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderCarrierComparison | null>(null);
  const [loading, startLoad] = useTransition();
  const [assigning, startAssign] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const load = () => startLoad(async () => setData(await getOrderCarrierComparison(orderId)));
  const choose = (key: string) => {
    setPendingKey(key);
    startAssign(async () => {
      const r = await assignOrderCarrier(orderId, key);
      if (r.ok) setData((d) => (d ? { ...d, selectedKey: key } : d));
      setPendingKey(null);
    });
  };

  const okRows = data?.rows.filter((r) => r.ok) ?? [];
  const cheapestKey = okRows[0]?.carrierKey;
  const cheapestCost = okRows[0]?.vndCost ?? 0;

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chọn carrier vận chuyển</div>
          {data && !data.error && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>{data.country} · {data.weightKg}kg</span>
              {data.currentPaidKey && <span>· khách trả <b className="text-foreground">{data.currentPaidKey}</b></span>}
              {data.selectedKey && <span className="rounded bg-emerald-500/15 px-1.5 py-px font-medium text-emerald-700 dark:text-emerald-400">đã chọn: {data.selectedKey}</span>}
            </div>
          )}
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
          {loading ? 'Đang báo giá…' : data ? '↻ Tải lại' : 'So sánh cước carrier'}
        </button>
      </header>

      {!data && !loading && (
        <p className="px-4 py-3 text-xs text-muted-foreground">Bấm “So sánh cước carrier” để báo giá đơn này qua mọi carrier đang bật.</p>
      )}
      {data?.error && <p className="px-4 py-3 text-xs text-amber-600 dark:text-amber-400">{data.error}</p>}

      {data && !data.error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Carrier</th>
                <th className="text-right">Base</th>
                <th className="text-right">Fuel</th>
                <th className="text-right">Phụ phí</th>
                <th className="text-right">VAT</th>
                <th className="text-right">Tổng cước</th>
                <th className="text-left">Zone</th>
                <th aria-label="Chọn"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const b = r.breakdown;
                const isCheap = r.carrierKey === cheapestKey;
                const isSel = r.carrierKey === data.selectedKey;
                if (!r.ok || !b) {
                  return (
                    <tr key={r.accountId} className="border-t border-border/60 text-muted-foreground">
                      <td className="px-3 py-3"><div className="font-medium text-foreground/70">{r.carrierKey}</div><div className="text-[11px]">{r.carrierName}</div></td>
                      <td colSpan={7} className="px-3 py-3 text-xs italic">Không báo giá được cho tuyến này ({r.error})</td>
                    </tr>
                  );
                }
                // Quy mọi dòng về VND: carrier chi phí ≠ VND (Aramex USD) nhân hệ số.
                const k = r.costCurrency !== 'VND' && b.carrierCost ? (r.vndCost ?? 0) / b.carrierCost : 1;
                const surchg = (b.remote + b.residential + b.demand + b.countryFixed + b.peak + b.addons + b.perStep + b.perKg) * k;
                const delta = (r.vndCost ?? 0) - cheapestCost;
                return (
                  <tr key={r.accountId}
                    className={`border-t border-border/60 ${isCheap ? 'bg-emerald-500/[0.06]' : ''} ${isSel ? 'ring-1 ring-inset ring-emerald-500/40' : ''}`}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{r.carrierKey}</span>
                        {isCheap && <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">rẻ nhất</span>}
                      </div>
                      <div className="text-[11px] leading-tight text-muted-foreground">{r.carrierName}{r.costCurrency !== 'VND' ? ` · quy đổi từ ${r.costCurrency}` : ''}</div>
                    </td>
                    <td className="px-3 py-3 text-right">{num(b.base * k)}</td>
                    <td className="px-3 py-3 text-right">{b.fuelPercent ? <>{num(b.fuel * k)}<span className="ml-1 text-[10px] text-muted-foreground">{b.fuelPercent}%</span></> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right">{surchg > 0 ? num(surchg) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right">{b.vatPercent ? <>{num(b.vat * k)}<span className="ml-1 text-[10px] text-muted-foreground">{b.vatPercent}%</span></> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right">
                      <div className={`font-semibold ${isCheap ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{vnd(r.vndCost)}</div>
                      {delta > 0 && <div className="text-[10px] text-muted-foreground">+{num(delta)}₫</div>}
                    </td>
                    <td className="px-3 py-3 text-left text-xs whitespace-nowrap text-muted-foreground">{r.zone}{r.tierUpperKg ? ` · ≤${r.tierUpperKg}kg` : ''}</td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" disabled={assigning || isSel} onClick={() => choose(r.carrierKey)}
                        className={`rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${isSel ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border hover:bg-muted'}`}>
                        {isSel ? '✓ Đã chọn' : pendingKey === r.carrierKey ? '…' : 'Chọn'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
