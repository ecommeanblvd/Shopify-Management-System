'use client';

import { useState, useTransition } from 'react';
import { getOrderCarrierComparison, assignOrderCarrier, type OrderCarrierComparison } from '@/features/shopify-orders/carrier-select-actions';

const vnd = (n?: number) => (typeof n === 'number' ? n.toLocaleString('vi-VN') + '₫' : '—');

/**
 * Panel so sánh cước tất cả carrier cho 1 đơn → staff chọn carrier đi hàng.
 * Lazy load (bấm mới quote). Hiện base/fuel/VAT/phụ phí + tổng, rẻ nhất tô xanh.
 */
export function CarrierComparePanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderCarrierComparison | null>(null);
  const [loading, startLoad] = useTransition();
  const [assigning, startAssign] = useTransition();

  const load = () => startLoad(async () => setData(await getOrderCarrierComparison(orderId)));
  const choose = (key: string) => startAssign(async () => {
    const r = await assignOrderCarrier(orderId, key);
    if (r.ok) setData((d) => (d ? { ...d, selectedKey: key } : d));
  });

  const okRows = data?.rows.filter((r) => r.ok) ?? [];
  const cheapest = okRows[0]?.carrierKey;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Chọn carrier vận chuyển</div>
        <button type="button" onClick={load} disabled={loading}
          className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
          {loading ? 'Đang báo giá…' : data ? 'Tải lại' : 'So sánh cước carrier'}
        </button>
      </div>

      {data?.error && <p className="mt-1 text-xs text-amber-700">{data.error}</p>}

      {data && !data.error && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.country} · {data.weightKg}kg
            {data.currentPaidKey && <> · khách trả: <b>{data.currentPaidKey}</b></>}
            {data.selectedKey && <> · đã chọn: <b className="text-emerald-700">{data.selectedKey}</b></>}
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="[&>th]:py-1 [&>th]:pr-2 [&>th]:text-left [&>th]:font-normal">
                  <th>Carrier</th><th className="text-right">Base</th><th className="text-right">Fuel</th>
                  <th className="text-right">Phụ phí</th><th className="text-right">VAT</th>
                  <th className="text-right">Tổng cước</th><th>Zone</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const b = r.breakdown;
                  const surchg = b ? b.remote + b.residential + b.demand + b.countryFixed + b.peak + b.addons + b.perStep + b.perKg : 0;
                  const isSel = r.carrierKey === data.selectedKey;
                  return (
                    <tr key={r.accountId} className={`border-t border-border/50 ${r.carrierKey === cheapest ? 'bg-emerald-500/10' : ''} ${isSel ? 'font-medium' : ''}`}>
                      <td className="py-1 pr-2">{r.carrierKey}{r.carrierKey === cheapest && <span className="ml-1 text-[10px] text-emerald-700">rẻ nhất</span>}<div className="text-[10px] text-muted-foreground">{r.carrierName}{r.costCurrency && r.costCurrency !== 'VND' && <span className="ml-1">· chi phí {r.costCurrency}</span>}</div></td>
                      {r.ok && b ? (
                        <>
                          <td className="py-1 pr-2 text-right">{b.base.toLocaleString('vi-VN')}</td>
                          <td className="py-1 pr-2 text-right">{b.fuelPercent ? `${b.fuel.toLocaleString('vi-VN')} (${b.fuelPercent}%)` : '—'}</td>
                          <td className="py-1 pr-2 text-right">{surchg ? surchg.toLocaleString('vi-VN') : '—'}</td>
                          <td className="py-1 pr-2 text-right">{b.vatPercent ? `${b.vat.toLocaleString('vi-VN')} (${b.vatPercent}%)` : '—'}</td>
                          <td className="py-1 pr-2 text-right font-semibold">{vnd(r.vndCost)}</td>
                          <td className="py-1 pr-2">{r.zone}{r.tierUpperKg ? ` ≤${r.tierUpperKg}kg` : ''}</td>
                          <td className="py-1 text-right">
                            <button type="button" disabled={assigning || isSel} onClick={() => choose(r.carrierKey)}
                              className={`rounded border px-2 py-0.5 text-[11px] ${isSel ? 'border-emerald-600 text-emerald-700' : 'hover:bg-muted'} disabled:opacity-60`}>
                              {isSel ? '✓ Đã chọn' : 'Chọn'}
                            </button>
                          </td>
                        </>
                      ) : (
                        <td colSpan={7} className="py-1 text-muted-foreground">Không báo giá được ({r.error})</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
