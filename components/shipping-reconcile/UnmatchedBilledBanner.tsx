'use client';
import { useState } from 'react';
// CHỈ import type — module unmatched-billed kéo db/schema (server). Banner là
// 'use client' nên import VALUE sẽ lôi db vào client bundle (build fail).
// Summary tính ở page (RSC) rồi truyền xuống.
import type { UnmatchedBilledRow, UnmatchedSummary } from '@/features/shipments/unmatched-billed';

const fmt = (n: number | null) => n === null ? '—' : Math.round(n).toLocaleString('vi-VN');

export function UnmatchedBilledBanner({ rows, summary, shipHoRows = [], returnRows = [] }: {
  rows: UnmatchedBilledRow[]; summary: UnmatchedSummary;
  /** Tracking thuộc đơn ship hộ — không phải tracking "lạ", chỉ hiện info riêng. */
  shipHoRows?: UnmatchedBilledRow[];
  /** Dòng bill là cước HÀNG HOÀN của đơn đã biết — hiện info riêng kèm đơn gốc. */
  returnRows?: UnmatchedBilledRow[];
}) {
  const [open, setOpen] = useState(false);
  const shipHoNote = shipHoRows.length > 0 ? (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-300">
      🚚 {shipHoRows.length} tracking trên hoá đơn thuộc <b>đơn ship hộ</b> ({shipHoRows.map((r) => r.shipHoCode).filter(Boolean).join(', ')}) — đối soát tự động ở <a href="/f/ship-ho" className="underline">module Ship hộ</a>, không phải tracking lạ.
    </div>
  ) : null;
  const returnNote = returnRows.length > 0 ? (
    <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-3 text-sm text-violet-800 dark:text-violet-300">
      ↩️ {returnRows.length} tracking là <b>cước hàng HOÀN</b> của đơn đã biết: {returnRows.map((r) => `${r.returnOfOrderNumber} (${(r.amountVnd ?? 0).toLocaleString('vi-VN')}đ)`).join(' · ')} — đã gắn về đơn gốc, tính vào chi phí ship của đơn.
    </div>
  ) : null;
  if (rows.length === 0) return <>{shipHoNote}{returnNote}</>;
  const byCarrier = summary.byCarrier
    .map((c) => `${c.carrierKey ?? '—'}: ${c.count} (${fmt(c.sumVnd)}đ)`)
    .join(' · ');
  return (
    <>
    {shipHoNote}
    {returnNote}
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpen((v) => !v)} className="text-left font-medium text-amber-700 dark:text-amber-400">
          ⚠ {rows.length} tracking trên hoá đơn chưa khớp shipment nào — kiểm tra tracking vận hành{byCarrier ? ` · ${byCarrier}` : ''} {open ? '▲' : '▼'}
        </button>
        <a href="/f/shipping-reconcile/unmatched-billed.csv" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Tải CSV</a>
      </div>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left"><th className="py-1 pr-3">Tracking</th><th className="py-1 pr-3">Hoá đơn</th><th className="py-1 pr-3">Carrier/Account</th><th className="py-1 pr-3">Số tiền</th><th className="py-1 pr-3">Kỳ</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tracking} className="border-t border-border/60">
                  <td className="py-1 pr-3 font-mono">{r.tracking}</td>
                  <td className="py-1 pr-3">{r.billNumber ?? '—'}</td>
                  <td className="py-1 pr-3">{r.carrierKey ?? '—'} · {r.accountName}</td>
                  <td className="py-1 pr-3 tabular-nums">{fmt(r.amountVnd)}</td>
                  <td className="py-1 pr-3">{r.billPeriodStart ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
}
