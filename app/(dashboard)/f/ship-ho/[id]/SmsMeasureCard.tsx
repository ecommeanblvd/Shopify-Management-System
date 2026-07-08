'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { updateSmsMeasurement } from '@/features/ship-ho/measure-actions';

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

/**
 * Cân & đo tại kho SMS. Mặc định: hiện số BRAND KHAI (MMP) tách trường rõ ràng +
 * dim quy đổi. Bấm "Đo lại" → modal nhập số SMS (Inecso) đo. Sau khi đo: bảng so
 * sánh song song 2 bên + cột lệch; giá đổi thì đã tự báo MMP (order.priced).
 */
export function SmsMeasureCard({ orderId, declared, sms, canManage }: {
  orderId: string;
  declared: DeclaredParcel;
  sms: SmsMeasured | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(sms?.weightKg ? String(sms.weightKg) : '');
  const [l, setL] = useState(sms?.dimLengthCm ? String(sms.dimLengthCm) : '');
  const [w, setW] = useState(sms?.dimWidthCm ? String(sms.dimWidthCm) : '');
  const [h, setH] = useState(sms?.dimHeightCm ? String(sms.dimHeightCm) : '');
  const [error, setError] = useState<string | null>(null);
  const [priceChange, setPriceChange] = useState<{ oldVnd: number; newVnd: number } | null>(null);
  const [notified, setNotified] = useState<'matched' | 'mismatch' | null>(null);
  const [pending, start] = useTransition();

  const decl = calc(declared);
  const smsCalc = sms ? calc(sms) : null;

  const save = () => start(async () => {
    setError(null);
    const r = await updateSmsMeasurement(orderId, {
      weightKg: Number(weight),
      dimLengthCm: l ? Number(l) : null, dimWidthCm: w ? Number(w) : null, dimHeightCm: h ? Number(h) : null,
    });
    if (!r.ok) { setError(r.error); return; }
    setPriceChange(r.priceChange);
    setNotified(r.matched ? 'matched' : 'mismatch');
    setOpen(false);
  });

  const diffCell = (a: number | null, b: number | null, unit: string) => {
    if (a == null || b == null) return <span className="text-muted-foreground">—</span>;
    const d = Math.round((b - a) * 1000) / 1000;
    if (d === 0) return <span className="text-emerald-600 dark:text-emerald-400">khớp</span>;
    return <span className="font-medium text-amber-600 dark:text-amber-400">{d > 0 ? '+' : ''}{d} {unit}</span>;
  };

  const numInput = 'w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm tabular-nums';

  return (
    <Card><CardContent className="p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Cân & đo tại kho SMS</div>
        {canManage && (
          <button type="button" onClick={() => setOpen(true)}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted">
            ⚖ {sms ? 'Đo lại (cập nhật)' : 'Đo lại'}
          </button>
        )}
      </div>

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
          <p className="mt-2 text-xs text-muted-foreground">Chưa cân/đo lại tại kho. Cân tính phí = max(cân nặng, dim quy đổi L×W×H/5000).</p>
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
              ⚠ Cân tính phí lệch {smsCalc!.chargeKg > decl.chargeKg ? '+' : ''}{Math.round((smsCalc!.chargeKg - decl.chargeKg) * 1000) / 1000} kg so với brand khai — giá thu đã re-quote theo số đo SMS.
            </div>
          )}
        </div>
      )}

      {/* Đã bắn order.measured sang MMP (khớp hay lệch đều gửi) */}
      {notified && (
        <div className={`rounded border px-3 py-2 text-xs ${notified === 'matched'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
          {notified === 'matched'
            ? <>✓ Số đo khớp brand khai — đã gửi thông báo khớp (<code>order.measured</code>, matched=true) sang MMP.</>
            : <>⚠ Số đo lệch brand khai — đã gửi số đo mới (<code>order.measured</code>, matched=false) sang MMP để ghi lên đơn brand.</>}
        </div>
      )}

      {/* Giá đổi sau đo lại → đã báo MMP ngay */}
      {priceChange && (
        <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
          💰 Giá thu cập nhật theo số đo mới: <s>{priceChange.oldVnd.toLocaleString('vi-VN')}₫</s> →{' '}
          <b>{priceChange.newVnd.toLocaleString('vi-VN')}₫</b>{' '}
          ({priceChange.newVnd - priceChange.oldVnd > 0 ? '+' : ''}{(priceChange.newVnd - priceChange.oldVnd).toLocaleString('vi-VN')}₫).
          Giá mới nằm trong block <code>price</code> của event <code>order.measured</code> đã gửi MMP.
        </div>
      )}

      {/* Modal nhập số đo */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Nhập số đo tại kho SMS">
          <div className="absolute inset-0 bg-black/50" onClick={() => !pending && setOpen(false)} />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl space-y-4">
            <div>
              <div className="text-base font-semibold">Cân & đo lại kiện hàng</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Brand khai: {declared.weightKg} kg
                {declared.dimLengthCm && declared.dimWidthCm && declared.dimHeightCm
                  ? ` · ${declared.dimLengthCm}×${declared.dimWidthCm}×${declared.dimHeightCm} cm` : ''}.
                Số khai báo gốc được giữ nguyên để đối chiếu.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">Cân nặng (kg) *
                <input className={`${numInput} mt-1`} inputMode="decimal" autoFocus value={weight}
                  onChange={(e) => setWeight(e.target.value)} placeholder={String(declared.weightKg)} />
              </label>
              <label className="text-xs text-muted-foreground">Chiều dài (cm)
                <input className={`${numInput} mt-1`} inputMode="decimal" value={l}
                  onChange={(e) => setL(e.target.value)} placeholder={declared.dimLengthCm ? String(declared.dimLengthCm) : '30'} />
              </label>
              <label className="text-xs text-muted-foreground">Chiều rộng (cm)
                <input className={`${numInput} mt-1`} inputMode="decimal" value={w}
                  onChange={(e) => setW(e.target.value)} placeholder={declared.dimWidthCm ? String(declared.dimWidthCm) : '24'} />
              </label>
              <label className="text-xs text-muted-foreground">Chiều cao (cm)
                <input className={`${numInput} mt-1`} inputMode="decimal" value={h}
                  onChange={(e) => setH(e.target.value)} placeholder={declared.dimHeightCm ? String(declared.dimHeightCm) : '11'} />
              </label>
            </div>
            {(() => {
              const wNum = Number(weight), lN = Number(l), wN = Number(w), hN = Number(h);
              const dimKg = l && w && h && lN > 0 && wN > 0 && hN > 0 ? Math.round(((lN * wN * hN) / DIM_DIVISOR) * 1000) / 1000 : null;
              const chargeKg = weight && wNum > 0 ? Math.max(wNum, dimKg ?? 0) : null;
              return chargeKg != null ? (
                <div className="rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Dim quy đổi: <b className="text-foreground">{dimKg ?? '—'} kg</b> · Cân tính phí: <b className="text-foreground">{chargeKg} kg</b>
                  {chargeKg !== decl.chargeKg && <span className="ml-1 text-amber-600 dark:text-amber-400">(brand khai {decl.chargeKg} kg)</span>}
                </div>
              ) : null;
            })()}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
                Hủy
              </button>
              <button type="button" disabled={pending || !weight || !(Number(weight) > 0)} onClick={save}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                {pending ? 'Đang lưu…' : 'Lưu số đo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </CardContent></Card>
  );
}
