import { Card, CardContent } from '@/components/ui/card';

const DELIVERY_LABEL: Record<string, { label: string; cls: string }> = {
  label_created: { label: 'Mới tạo nhãn', cls: 'bg-muted text-muted-foreground' },
  in_transit: { label: 'Đang vận chuyển', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  out_for_delivery: { label: 'Đang giao', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  delivered: { label: 'Đã giao', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  returning: { label: 'Đang hoàn về', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  exception: { label: 'Sự cố', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  unknown: { label: 'Chưa rõ', cls: 'bg-muted text-muted-foreground' },
};

const TRACK_URL: Record<string, (tn: string) => string> = {
  fedex: (tn) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
  dhl: (tn) => `https://www.dhl.com/vn-en/home/tracking.html?tracking-id=${encodeURIComponent(tn)}`,
};

/**
 * CHỈ hiển thị trạng thái vận đơn (tracking đang ở đâu, có sự cố không).
 * Mọi thao tác (gắn/sửa tracking, update trạng thái tay) nằm trên thanh
 * Thao tác kho đầu trang.
 */
export function TrackingCard({
  trackingNumber, carrierKey, deliveryStatus, deliveredAt, trackDetail, lastTrackedAt,
}: {
  trackingNumber: string | null; carrierKey: string | null;
  deliveryStatus: string | null; deliveredAt: Date | null;
  /** Lời của HÃNG ở lượt tra gần nhất — xem `ship_ho_orders.track_detail`. */
  trackDetail?: string | null;
  lastTrackedAt?: Date | null;
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
      {/* Lời của HÃNG, hiện RIÊNG khỏi nhãn trạng thái: từ 02/10 hãng không kéo trạng thái lùi
          được (lib/fedex/track.ts), nên hai thứ này CÓ THỂ nói khác nhau — ví dụ nhãn "đang đi
          giao" do đội vận hành gõ, còn hãng nói "mới nhận hàng". Giấu dòng này đi là để người
          đối soát không bao giờ thấy chênh lệch đó. */}
      {trackingNumber && trackDetail && (
        <p className="text-xs text-muted-foreground">
          Hãng báo: <span className="text-foreground">{trackDetail}</span>
          {lastTrackedAt ? ` · tra lúc ${new Date(lastTrackedAt).toLocaleString('vi-VN')}` : ''}
        </p>
      )}
    </CardContent></Card>
  );
}
