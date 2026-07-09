import { Card, CardContent } from '@/components/ui/card';
import { ManualStatusControl } from './ManualStatusControl';

const DELIVERY_LABEL: Record<string, { label: string; cls: string }> = {
  in_transit: { label: 'Đang vận chuyển', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  out_for_delivery: { label: 'Đang giao', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  delivered: { label: 'Đã giao', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  exception: { label: 'Sự cố', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  unknown: { label: 'Chưa rõ', cls: 'bg-muted text-muted-foreground' },
};

const TRACK_URL: Record<string, (tn: string) => string> = {
  fedex: (tn) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
  dhl: (tn) => `https://www.dhl.com/vn-en/home/tracking.html?tracking-id=${encodeURIComponent(tn)}`,
};

/**
 * CHỈ hiển thị trạng thái vận đơn (tracking đang ở đâu, có sự cố không).
 * Gắn/sửa tracking là button action riêng trên header (AddTrackingButton).
 */
export function TrackingCard({
  orderId, trackingNumber, carrierKey, deliveryStatus, deliveredAt, canManage,
}: {
  orderId: string; trackingNumber: string | null; carrierKey: string | null;
  deliveryStatus: string | null; deliveredAt: Date | null; canManage: boolean;
}) {
  const st = deliveryStatus ? (DELIVERY_LABEL[deliveryStatus] ?? { label: deliveryStatus, cls: 'bg-muted text-muted-foreground' }) : null;
  const url = trackingNumber && carrierKey && TRACK_URL[carrierKey] ? TRACK_URL[carrierKey](trackingNumber) : null;

  return (
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Vận đơn &amp; giao hàng</div>
      {!trackingNumber ? (
        <p className="text-muted-foreground text-xs">Chưa có tracking — bấm “＋ Gắn tracking” trên đầu trang sau khi book với carrier.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-xs text-muted-foreground uppercase">{carrierKey ?? 'carrier ?'}</span>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline-offset-2 hover:underline">{trackingNumber}</a>
          ) : (
            <span className="font-mono">{trackingNumber}</span>
          )}
          {st && (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.cls}`}>
              {st.label}{deliveredAt ? ` · ${new Date(deliveredAt).toLocaleDateString('vi-VN')}` : ''}
            </span>
          )}
          {deliveryStatus === 'exception' && (
            <span className="text-xs text-red-600 dark:text-red-400">Kiểm tra với carrier / cập nhật brand nếu delay.</span>
          )}
        </div>
      )}
      {canManage && trackingNumber && <ManualStatusControl orderId={orderId} current={deliveryStatus} />}
    </CardContent></Card>
  );
}
