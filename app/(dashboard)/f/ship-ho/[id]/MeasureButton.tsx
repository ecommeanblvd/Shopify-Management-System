'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSmsMeasurement } from '@/features/ship-ho/measure-actions';
import type { DeclaredParcel, SmsMeasured } from './SmsMeasureCard';

const DIM_DIVISOR = 5000; // FedEx/DHL: L×W×H(cm)/5000 = dim weight (kg)

/**
 * Nút "⚖ Đo lại" trên thanh Thao tác kho — mở modal nhập số đo tại kho Inecso.
 * Lưu xong: modal chuyển sang màn kết quả (đã báo MMP / giá đổi) rồi Đóng;
 * card "Cân & đo" bên dưới CHỈ hiển thị (refresh tự cập nhật bảng so sánh).
 */
export function MeasureButton({ orderId, declared, sms }: {
  orderId: string;
  declared: DeclaredParcel;
  sms: SmsMeasured | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(sms?.weightKg ? String(sms.weightKg) : '');
  const [l, setL] = useState(sms?.dimLengthCm ? String(sms.dimLengthCm) : '');
  const [w, setW] = useState(sms?.dimWidthCm ? String(sms.dimWidthCm) : '');
  const [h, setH] = useState(sms?.dimHeightCm ? String(sms.dimHeightCm) : '');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    notified: 'matched' | 'mismatch';
    priceChange: { oldVnd: number; newVnd: number } | null;
  } | null>(null);
  const [pending, start] = useTransition();

  const declDimKg = declared.dimLengthCm && declared.dimWidthCm && declared.dimHeightCm
    ? Math.round(((declared.dimLengthCm * declared.dimWidthCm * declared.dimHeightCm) / DIM_DIVISOR) * 1000) / 1000
    : null;
  const declChargeKg = Math.max(declared.weightKg, declDimKg ?? 0);

  const save = () => start(async () => {
    setError(null);
    const r = await updateSmsMeasurement(orderId, {
      weightKg: Number(weight),
      dimLengthCm: l ? Number(l) : null, dimWidthCm: w ? Number(w) : null, dimHeightCm: h ? Number(h) : null,
    });
    if (!r.ok) { setError(r.error); return; }
    setDone({ notified: r.matched ? 'matched' : 'mismatch', priceChange: r.priceChange });
    router.refresh();
  });

  const close = () => { if (!pending) { setOpen(false); setDone(null); } };
  const numInput = 'w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm tabular-nums';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted">
        ⚖ {sms ? 'Đo lại (cập nhật)' : 'Đo lại'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Nhập số đo tại kho Inecso">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl space-y-4">
            {done ? (
              <>
                <div className="text-base font-semibold">Đã lưu số đo</div>
                <div className={`rounded border px-3 py-2 text-xs ${done.notified === 'matched'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
                  {done.notified === 'matched'
                    ? <>✓ Số đo khớp brand khai — đã gửi thông báo khớp (<code>order.measured</code>) sang MMP.</>
                    : <>⚠ Số đo lệch brand khai — đã gửi số đo mới (<code>order.measured</code>) sang MMP để ghi lên đơn brand.</>}
                </div>
                {done.priceChange && (
                  <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
                    💰 Giá thu cập nhật: <s>{done.priceChange.oldVnd.toLocaleString('vi-VN')}₫</s> →{' '}
                    <b>{done.priceChange.newVnd.toLocaleString('vi-VN')}₫</b>{' '}
                    ({done.priceChange.newVnd - done.priceChange.oldVnd > 0 ? '+' : ''}{(done.priceChange.newVnd - done.priceChange.oldVnd).toLocaleString('vi-VN')}₫) — đã báo MMP.
                  </div>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={close}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90">
                    Đóng
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-base font-semibold">Cân &amp; đo lại kiện hàng</div>
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
                      {chargeKg !== declChargeKg && <span className="ml-1 text-amber-600 dark:text-amber-400">(brand khai {declChargeKg} kg)</span>}
                    </div>
                  ) : null;
                })()}
                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={pending} onClick={close}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
                    Hủy
                  </button>
                  <button type="button" disabled={pending || !weight || !(Number(weight) > 0)} onClick={save}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                    {pending ? 'Đang lưu…' : 'Lưu số đo'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
