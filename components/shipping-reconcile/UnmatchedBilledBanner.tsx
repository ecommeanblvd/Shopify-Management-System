'use client';
import { useState } from 'react';
// CHỈ import type — module unmatched-billed kéo db/schema (server). Banner là
// 'use client' nên import VALUE sẽ lôi db vào client bundle (build fail).
// Summary tính ở page (RSC) rồi truyền xuống.
import type { UnmatchedBilledRow, UnmatchedSummary } from '@/features/shipments/unmatched-billed';

const fmt = (n: number | null) => n === null ? '—' : Math.round(n).toLocaleString('vi-VN');

export function UnmatchedBilledBanner({ rows, summary }: { rows: UnmatchedBilledRow[]; summary: UnmatchedSummary }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const byCarrier = summary.byCarrier
    .map((c) => `${c.carrierKey ?? '—'}: ${c.count} (${fmt(c.sumVnd)}đ)`)
    .join(' · ');
  return (
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
  );
}
