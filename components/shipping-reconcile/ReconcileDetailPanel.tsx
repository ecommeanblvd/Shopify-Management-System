'use client';

import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

const CAUSE_LABEL: Record<string, string> = {
  KHOP: '', SAI_CAN: 'sai cân', THIEU_CAU_HINH_REMOTE: 'thiếu cấu hình vùng xa',
  REMOTE_KHONG_KHOP: 'remote không khớp', LECH_RATE_CARD: 'lệch rate card',
  LECH_CHIET_KHAU: 'lệch chiết khấu', LECH_FUEL: 'lệch % fuel',
  SAI_ZONE: 'lệch zone',
  PHAI_SINH: 'phái sinh', KHONG_KHOP: 'không khớp', LAM_TRON: 'làm tròn',
};

function severityClass(s: string): string {
  switch (s) {
    case 'match': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'weight': return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'zone': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'config': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'ratecard': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'discount': return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

type CompKey = 'base' | 'fuel' | 'remote' | 'demand' | 'signature' | 'gogreen' | 'vat';

interface ComponentLine {
  label: string;
  billed: number | null;
  engine: number | null;
  /** Diagnosis component key this display line maps to. */
  compKey: CompKey;
}

/** Sum engine sub-charges that share a display line, preserving null when the
 *  engine produced no quote (every part null). */
function sumEngine(...parts: Array<number | null>): number | null {
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

function lines(row: ReconcileViewRow): ComponentLine[] {
  return [
    { label: 'Cước gốc (sau giảm giá)', billed: row.billedBaseNet, engine: row.engineBaseNet, compKey: 'base' },
    { label: 'Phụ phí xăng dầu (fuel)', billed: row.billedFuel, engine: row.engineFuel, compKey: 'fuel' },
    { label: 'Vùng xa (remote)', billed: row.billedRemote, engine: row.engineRemote, compKey: 'remote' },
    { label: 'Phụ phí nhu cầu (demand)', billed: row.billedDemand, engine: row.engineDemand, compKey: 'demand' },
    // signature: engine books DHL's fee under peak_fixed, FedEx under residential_fixed.
    { label: 'Ký nhận (signature)', billed: row.billedSignature, engine: sumEngine(row.engineResidential, row.enginePeak), compKey: 'signature' },
    // gogreen: engine books DHL GoGreen under per_step_fixed.
    { label: 'GoGreen', billed: row.billedGogreen, engine: row.enginePerStep, compKey: 'gogreen' },
    { label: 'VAT', billed: row.billedVat, engine: row.engineVat, compKey: 'vat' },
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
      {row.diagnosis && (
        <div className="mb-4 space-y-2">
          <div className={`rounded-md px-3 py-2 text-sm font-medium ${severityClass(row.diagnosis.severity)}`}>
            {row.diagnosis.verdict}
          </div>
          {row.diagnosis.impliedWeight && (
            <p className="text-xs text-muted-foreground">
              Truy ngược: carrier tính như thể{' '}
              <span className="font-semibold">
                {row.diagnosis.impliedWeight.rangeKg[0]}–{row.diagnosis.impliedWeight.rangeKg[1]} kg
              </span>{' '}
              (bậc ≤ {row.diagnosis.impliedWeight.tierUpperKg} kg), hệ thống dùng{' '}
              <span className="font-semibold">{row.diagnosis.impliedWeight.engineChargeableKg} kg</span>
              {row.diagnosis.impliedWeight.deltaTiers > 0 ? ` — lệch ${row.diagnosis.impliedWeight.deltaTiers} bậc` : ''}.
            </p>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1">Khoản phí</th>
            <th className="text-right py-1">Billed</th>
            <th className="text-right py-1">Hệ thống</th>
            <th className="text-right py-1">Lệch</th>
            <th className="text-right py-1">Chẩn đoán</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {lines(row).map((l) => {
            const delta = l.billed !== null && l.engine !== null ? l.billed - l.engine : null;
            const comp = row.diagnosis?.components.find((x) => x.key === l.compKey);
            const causeLabel = comp && comp.cause !== 'KHOP' ? CAUSE_LABEL[comp.cause] : '';
            return (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 font-sans">{l.label}</td>
                <td className="py-1 text-right">{fmtVnd(l.billed)}</td>
                <td className="py-1 text-right">{fmtVnd(l.engine)}</td>
                <td className={`py-1 text-right ${delta && Math.abs(delta) > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {fmtVnd(delta)}
                </td>
                <td className="py-1 text-right font-sans text-[11px] text-muted-foreground">{causeLabel}</td>
              </tr>
            );
          })}
          {(() => {
            // Residual = whatever the engine total includes that no display line
            // above accounts for (e.g. country_fixed). Surfaced so the rows
            // always reconcile to the total instead of hiding money.
            const res = row.diagnosis?.components.find((x) => x.key === 'residual');
            if (!res || res.delta === 0) return null;
            return (
              <tr className="border-t border-border">
                <td className="py-1 font-sans">Khác / làm tròn</td>
                <td className="py-1 text-right text-muted-foreground">—</td>
                <td className="py-1 text-right text-muted-foreground">—</td>
                <td className="py-1 text-right">{fmtVnd(res.delta)}</td>
                <td className="py-1 text-right font-sans text-[11px] text-muted-foreground">{CAUSE_LABEL[res.cause] ?? ''}</td>
              </tr>
            );
          })()}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 font-sans">Tổng</td>
            <td className="py-1 text-right">{fmtVnd(row.billedTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.engineTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.deltaVnd)}</td>
            <td className="py-1"></td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Giảm giá hợp đồng đã được gộp vào &quot;Cước gốc (sau giảm giá)&quot;. Billed gốc trên hóa đơn: {fmtVnd(row.billedBase)} − giảm {fmtVnd(row.billedDiscount)}.
      </p>
    </div>
  );
}
