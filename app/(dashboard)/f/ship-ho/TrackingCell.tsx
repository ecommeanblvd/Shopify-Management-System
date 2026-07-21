'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setShipHoDeliveryStatusManual, type ManualDeliveryStatus } from '@/features/ship-ho/tracking-actions';

const TRACK_URL: Record<string, (tn: string) => string> = {
  fedex: (tn) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
  dhl: (tn) => `https://www.dhl.com/vn-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(tn)}`,
};

const STATUS_OPTIONS: Array<{ value: ManualDeliveryStatus; label: string }> = [
  { value: 'in_transit', label: 'Đang vận chuyển' },
  { value: 'out_for_delivery', label: 'Đang giao' },
  { value: 'delivered', label: 'Đã giao (hôm nay)' },
  { value: 'exception', label: 'Sự cố' },
];

/** Cột Tracking trên bảng: link mở trang tracking carrier (tab mới) + nút ✎ đổi
 *  trạng thái tại chỗ. stopPropagation để không kích hoạt click-mở-chi-tiết của row. */
export function TrackingCell({ orderId, trackingNumber, carrierKey, deliveryStatus, canManage }: {
  orderId: string;
  trackingNumber: string | null;
  carrierKey: string | null;
  deliveryStatus: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!trackingNumber) return <span className="text-muted-foreground">—</span>;
  const url = carrierKey && TRACK_URL[carrierKey]
    ? TRACK_URL[carrierKey](trackingNumber)
    : `https://www.google.com/search?q=${encodeURIComponent(trackingNumber + ' tracking')}`;

  return (
    <span className="relative inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a
        href={url} target="_blank" rel="noreferrer"
        className="font-mono text-[11px] text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
        title={`Mở trang tracking ${carrierKey?.toUpperCase() ?? ''} (tab mới)`}
      >
        {trackingNumber}↗
      </a>
      {canManage && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-border px-1 py-px text-[10px] text-muted-foreground hover:bg-muted"
          title="Cập nhật trạng thái giao tại chỗ"
        >✎</button>
      )}
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 flex min-w-40 flex-col rounded-md border border-border bg-popover p-1 shadow-md">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await setShipHoDeliveryStatusManual(
                  orderId, o.value,
                  o.value === 'delivered' ? new Date().toISOString() : undefined,
                );
                setBusy(false);
                setOpen(false);
                if (r.ok) router.refresh();
                else alert(r.error ?? 'Lỗi cập nhật');
              }}
              className={`rounded px-2 py-1 text-left text-[11px] hover:bg-muted disabled:opacity-50 ${deliveryStatus === o.value ? 'font-semibold text-primary' : ''}`}
            >{o.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}
