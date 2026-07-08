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

function chargeable(p: { weightKg: number; dimLengthCm: number | null; dimWidthCm: number | null; dimHeightCm: number | null }): { dimKg: number | null; kg: number } {
  const { dimLengthCm: l, dimWidthCm: w, dimHeightCm: h } = p;
  const dimKg = l && w && h ? Math.round(((l * w * h) / DIM_DIVISOR) * 1000) / 1000 : null;
  return { dimKg, kg: Math.max(p.weightKg, dimKg ?? 0) };
}

/**
 * Nhân viên vận hành SMS cân & đo lại kiện khi hàng về kho. So với số brand khai
 * (MMP gửi sang): lệch cân/thể tích → highlight ngay. Không ghi đè số khai báo.
 */
export function SmsMeasureCard({ orderId, declared, sms, canManage }: {
  orderId: string;
  declared: DeclaredParcel;
  sms: SmsMeasured | null;
  canManage: boolean;
}) {
  const [weight, setWeight] = useState(sms?.weightKg ? String(sms.weightKg) : '');
  const [l, setL] = useState(sms?.dimLengthCm ? String(sms.dimLengthCm) : '');
  const [w, setW] = useState(sms?.dimWidthCm ? String(sms.dimWidthCm) : '');
  const [h, setH] = useState(sms?.dimHeightCm ? String(sms.dimHeightCm) : '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [priceChange, setPriceChange] = useState<{ oldVnd: number; newVnd: number } | null>(null);
  const [pending, start] = useTransition();

  const decl = chargeable(declared);
  const smsCalc = sms ? chargeable(sms) : null;
  const weightDiff = sms ? Math.round((sms.weightKg - declared.weightKg) * 1000) / 1000 : null;
  const chargeDiff = smsCalc ? Math.round((smsCalc.kg - decl.kg) * 1000) / 1000 : null;

  const save = () => start(async () => {
    setError(null); setSaved(false); setPriceChange(null);
    const r = await updateSmsMeasurement(orderId, {
      weightKg: Number(weight),
      dimLengthCm: l ? Number(l) : null, dimWidthCm: w ? Number(w) : null, dimHeightCm: h ? Number(h) : null,
    });
    if (!r.ok) setError(r.error);
    else { setSaved(true); setPriceChange(r.priceChange); }
  });

  const numInput = 'w-24 rounded border border-border bg-background px-2 py-1 text-sm tabular-nums';

  return (
    <Card><CardContent className="p-4 space-y-3 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Cân & đo lại tại kho SMS</div>

      {/* Đối chiếu brand khai vs SMS đo */}
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Brand khai (MMP)</div>
          <div className="tabular-nums">
            {declared.weightKg} kg
            {declared.dimLengthCm && declared.dimWidthCm && declared.dimHeightCm
              ? ` · ${declared.dimLengthCm}×${declared.dimWidthCm}×${declared.dimHeightCm} cm`
              : ' · chưa khai kích thước'}
          </div>
          <div className="text-xs text-muted-foreground">
            {decl.dimKg != null && `dim ${decl.dimKg} kg · `}tính phí {decl.kg} kg
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">SMS đo{sms?.measuredAt ? ` · ${new Date(sms.measuredAt).toLocaleDateString('vi-VN')}` : ''}</div>
          {sms ? (
            <>
              <div className="tabular-nums">
                {sms.weightKg} kg
                {sms.dimLengthCm && sms.dimWidthCm && sms.dimHeightCm
                  ? ` · ${sms.dimLengthCm}×${sms.dimWidthCm}×${sms.dimHeightCm} cm`
                  : ' · chưa đo kích thước'}
              </div>
              <div className="text-xs text-muted-foreground">
                {smsCalc!.dimKg != null && `dim ${smsCalc!.dimKg} kg · `}tính phí {smsCalc!.kg} kg
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">Chưa cân/đo lại.</div>
          )}
        </div>
      </div>

      {/* Cảnh báo lệch */}
      {sms && (weightDiff !== 0 || (chargeDiff != null && chargeDiff !== 0)) && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          ⚠ Lệch so với brand khai:
          {weightDiff !== 0 && <> cân {weightDiff! > 0 ? '+' : ''}{weightDiff} kg</>}
          {chargeDiff != null && chargeDiff !== 0 && <> · cân tính phí {chargeDiff > 0 ? '+' : ''}{chargeDiff} kg</>}
          . Báo MMP/brand nếu cần điều chỉnh; cước thực sẽ chốt theo hoá đơn carrier.
        </div>
      )}
      {sms && weightDiff === 0 && (chargeDiff == null || chargeDiff === 0) && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400">✓ Khớp với số brand khai.</div>
      )}

      {/* Form nhập (chỉ khi có quyền quản lý) */}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="text-xs text-muted-foreground">Cân (kg)
            <input className={`${numInput} block`} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="2.4" />
          </label>
          <label className="text-xs text-muted-foreground">Dài (cm)
            <input className={`${numInput} block`} inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} placeholder="30" />
          </label>
          <label className="text-xs text-muted-foreground">Rộng (cm)
            <input className={`${numInput} block`} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} placeholder="24" />
          </label>
          <label className="text-xs text-muted-foreground">Cao (cm)
            <input className={`${numInput} block`} inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} placeholder="11" />
          </label>
          <button type="button" onClick={save} disabled={pending || !weight}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
            {pending ? 'Đang lưu…' : sms ? 'Cập nhật số đo' : 'Lưu số đo'}
          </button>
          {saved && !priceChange && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Đã lưu — giá không đổi</span>}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      )}

      {/* Giá đổi sau đo lại → đã báo MMP ngay */}
      {priceChange && (
        <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
          💰 Giá thu cập nhật theo số đo mới: <s>{priceChange.oldVnd.toLocaleString('vi-VN')}₫</s> →{' '}
          <b>{priceChange.newVnd.toLocaleString('vi-VN')}₫</b>{' '}
          ({priceChange.newVnd - priceChange.oldVnd > 0 ? '+' : ''}{(priceChange.newVnd - priceChange.oldVnd).toLocaleString('vi-VN')}₫).
          Đã gửi event <code>order.priced</code> sang MMP để brand biết giá mới.
        </div>
      )}
    </CardContent></Card>
  );
}
