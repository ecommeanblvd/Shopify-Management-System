'use client';

import { useState, useTransition } from 'react';
import { setShipHoTracking } from '@/features/ship-ho/tracking-actions';

/**
 * Action chính của đơn: gắn/sửa tracking — button nổi bật (màu riêng) trên header,
 * mở modal nhập carrier + tracking. Card "Vận đơn & giao hàng" bên dưới CHỈ hiển thị.
 */
export function AddTrackingButton({ orderId, trackingNumber, carrierKey }: {
  orderId: string;
  trackingNumber: string | null;
  carrierKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tn, setTn] = useState(trackingNumber ?? '');
  const [carrier, setCarrier] = useState(carrierKey ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setErr(null);
    const r = await setShipHoTracking(orderId, {
      trackingNumber: tn,
      carrierKey: carrier === 'fedex' || carrier === 'dhl' ? carrier : null,
    });
    if (!r.ok) { setErr(r.error ?? 'Lỗi'); return; }
    setOpen(false);
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sky-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700">
        {trackingNumber ? '✎ Sửa tracking' : '＋ Gắn tracking'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Gắn tracking">
          <div className="absolute inset-0 bg-black/50" onClick={() => !pending && setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-xl space-y-4">
            <div>
              <div className="text-base font-semibold">{trackingNumber ? 'Sửa tracking' : 'Gắn tracking cho đơn'}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">Nhập vận đơn sau khi book với carrier. Trạng thái giao sẽ tự cập nhật theo tracking.</p>
            </div>
            <div className="space-y-3">
              <label className="block text-xs text-muted-foreground">Carrier
                <select className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                  value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                  <option value="">— chọn carrier —</option>
                  <option value="fedex">FedEx</option>
                  <option value="dhl">DHL</option>
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">Tracking number
                <input className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm"
                  autoFocus value={tn} onChange={(e) => setTn(e.target.value)} placeholder="771234567890" />
              </label>
            </div>
            {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
                Hủy
              </button>
              <button type="button" disabled={pending || !tn.trim()} onClick={save}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700 disabled:opacity-50">
                {pending ? 'Đang lưu…' : 'Lưu tracking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
