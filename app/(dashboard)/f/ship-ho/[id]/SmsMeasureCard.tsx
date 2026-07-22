import { Card, CardContent } from '@/components/ui/card';

const DIM_DIVISOR = 5000; // FedEx/DHL: L×W×H(cm)/5000 = dim weight (kg)

export interface DeclaredParcel {
  weightKg: number;
  dimLengthCm: number | null;
  dimWidthCm: number | null;
  dimHeightCm: number | null;
}
export interface SmsMeasured extends DeclaredParcel {
  measuredAt: string | null; // ISO
}

function calc(p: DeclaredParcel): { dimKg: number | null; chargeKg: number } {
  const { dimLengthCm: l, dimWidthCm: w, dimHeightCm: h } = p;
  const dimKg = l && w && h ? Math.round(((l * w * h) / DIM_DIVISOR) * 1000) / 1000 : null;
  return { dimKg, chargeKg: Math.max(p.weightKg, dimKg ?? 0) };
}

const fmt = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${v} ${unit}`);

function diffCell(a: number | null, b: number | null, unit: string) {
  if (a == null || b == null) return <span className="text-muted-foreground">—</span>;
  const d = Math.round((b - a) * 1000) / 1000;
  if (d === 0) return <span className="text-emerald-600 dark:text-emerald-400">khớp</span>;
  return <span className="font-medium text-amber-600 dark:text-amber-400">{d > 0 ? '+' : ''}{d} {unit}</span>;
}

/**
 * Cân & đo tại kho Inecso — CHỈ HIỂN THỊ (nhập số đo qua nút "⚖ Đo lại" trên
 * thanh Thao tác kho đầu trang). Chưa đo: số brand khai + dim quy đổi; đã đo:
 * bảng so sánh song song brand khai vs Inecso đo + cột lệch.
 */
export function SmsMeasureCard({ declared, sms }: {
  declared: DeclaredParcel;
  sms: SmsMeasured | null;
}) {
  const decl = calc(declared);
  const smsCalc = sms ? calc(sms) : null;

  return (
    <Card><CardContent className="p-4 space-y-3 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Cân &amp; đo tại kho Inecso</div>

      {!sms ? (
        /* Chưa đo: chỉ hiện số brand khai, tách trường rõ ràng */
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">Brand khai báo (MMP)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ['Cân nặng', fmt(declared.weightKg, 'kg')],
              ['Chiều dài', fmt(declared.dimLengthCm, 'cm')],
              ['Chiều rộng', fmt(declared.dimWidthCm, 'cm')],
              ['Chiều cao', fmt(declared.dimHeightCm, 'cm')],
              ['Dim quy đổi', decl.dimKg == null ? '—' : `${decl.dimKg} kg`],
              ['Cân tính phí', `${decl.chargeKg} kg`],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="font-medium tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Chưa cân/đo lại tại kho — bấm “⚖ Đo lại” trên đầu trang khi hàng về. Cân tính phí = max(cân nặng, dim quy đổi L×W×H/5000).</p>
        </div>
      ) : (
        /* Đã đo: bảng so sánh song song brand khai vs SMS đo */
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:py-1.5 [&>th]:font-medium">
                <th className="text-left">Thông số</th>
                <th className="text-right">Brand khai (MMP)</th>
                <th className="text-right">Inecso (SMS) đo{sms.measuredAt ? <span className="ml-1 normal-case font-normal">· {new Date(sms.measuredAt).toLocaleDateString('vi-VN')}</span> : null}</th>
                <th className="text-right">Lệch</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Cân nặng', declared.weightKg, sms.weightKg, 'kg'],
                ['Chiều dài', declared.dimLengthCm, sms.dimLengthCm, 'cm'],
                ['Chiều rộng', declared.dimWidthCm, sms.dimWidthCm, 'cm'],
                ['Chiều cao', declared.dimHeightCm, sms.dimHeightCm, 'cm'],
                ['Dim quy đổi', decl.dimKg, smsCalc!.dimKg, 'kg'],
                ['Cân tính phí', decl.chargeKg, smsCalc!.chargeKg, 'kg'],
              ] as const).map(([label, a, b, unit]) => (
                <tr key={label} className={`border-t border-border/60 [&>td]:py-1.5 ${label === 'Cân tính phí' ? 'font-medium bg-muted/20' : ''}`}>
                  <td className="text-left">{label}</td>
                  <td className="text-right">{fmt(a, unit)}</td>
                  <td className="text-right">{fmt(b, unit)}</td>
                  <td className="text-right">{diffCell(a, b, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {smsCalc!.chargeKg !== decl.chargeKg && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              ⚠ Cân tính phí lệch {smsCalc!.chargeKg > decl.chargeKg ? '+' : ''}{Math.round((smsCalc!.chargeKg - decl.chargeKg) * 1000) / 1000} kg so với brand khai — giá thu đã re-quote theo số đo Inecso.
            </div>
          )}
        </div>
      )}
    </CardContent></Card>
  );
}
