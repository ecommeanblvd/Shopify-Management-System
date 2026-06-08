'use client';

import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

interface ComponentLine {
  label: string;
  billed: number | null;
  engine: number | null;
  /** Optional human note explaining a known cause of the delta. */
  hint?: string;
}

function lines(row: ReconcileViewRow): ComponentLine[] {
  return [
    { label: 'Cước gốc (sau giảm giá)', billed: row.billedBaseNet, engine: row.engineBaseNet },
    { label: 'Phụ phí xăng dầu (fuel)', billed: row.billedFuel, engine: row.engineFuel },
    { label: 'Vùng xa (remote)', billed: row.billedRemote, engine: row.engineRemote },
    { label: 'Phụ phí nhu cầu (demand)', billed: row.billedDemand, engine: row.engineDemand },
    { label: 'Ký nhận (signature)', billed: row.billedSignature, engine: row.engineResidential },
    { label: 'VAT', billed: row.billedVat, engine: row.engineVat },
  ];
}

export function ReconcileDetailPanel({ row }: { row: ReconcileViewRow }) {
  if (row.engineTotal === null) {
    return (
      <div className="p-4 text-sm text-amber-600 dark:text-amber-400">
        Hệ thống chưa tính được giá cho đơn này (lý do: {row.engineReason ?? 'không rõ'}). Không có số liệu để đối soát từng khoản.
      </div>
    );
  }
  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1">Khoản phí</th>
            <th className="text-right py-1">Billed</th>
            <th className="text-right py-1">Hệ thống</th>
            <th className="text-right py-1">Lệch</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {lines(row).map((l) => {
            const delta = l.billed !== null && l.engine !== null ? l.billed - l.engine : null;
            return (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 font-sans">{l.label}</td>
                <td className="py-1 text-right">{fmtVnd(l.billed)}</td>
                <td className="py-1 text-right">{fmtVnd(l.engine)}</td>
                <td className={`py-1 text-right ${delta && Math.abs(delta) > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {fmtVnd(delta)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 font-sans">Tổng</td>
            <td className="py-1 text-right">{fmtVnd(row.billedTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.engineTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.deltaVnd)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Giảm giá hợp đồng đã được gộp vào &quot;Cước gốc (sau giảm giá)&quot;. Billed gốc trên hóa đơn: {fmtVnd(row.billedBase)} − giảm {fmtVnd(row.billedDiscount)}.
      </p>
    </div>
  );
}
