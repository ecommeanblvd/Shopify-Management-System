export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
export interface Badge { label: string; tone: BadgeTone }

export function summarizeAddr(o: { addrDeliverable: boolean | null; addrVerifiedAt: Date | string | null; addrConfidence?: string | null }): Badge {
  switch (o.addrConfidence) {
    case 'verified':
    case 'census_verified': return { label: '✓ Giao được', tone: 'ok' };
    case 'zip_only': return { label: '⚠ ZIP hợp lệ, chưa rõ số nhà', tone: 'warn' };
    case 'undeliverable': return { label: '⚠ Không giao được', tone: 'bad' };
  }
  // null / giá trị lạ → fallback boolean cũ
  if (!o.addrVerifiedAt) return { label: 'Chưa verify', tone: 'muted' };
  if (o.addrDeliverable === false) return { label: '⚠ Không giao được', tone: 'bad' };
  return { label: '✓ Giao được', tone: 'ok' };
}

export function summarizeKcs(o: { pending: number; pass: number; fail: number }, larkQc?: string | null): Badge {
  // Ưu tiên QC hệ thống (goods_receipt_items) nếu có dữ liệu.
  if (o.fail > 0) return { label: 'Lỗi', tone: 'bad' };
  if (o.pending > 0) return { label: 'Chờ', tone: 'warn' };
  if (o.pass > 0) return { label: 'Đạt', tone: 'ok' };
  // Fallback Lark QC.
  switch (larkQc) {
    case 'fail': return { label: 'Lỗi', tone: 'bad' };
    case 'pending': return { label: 'Chờ', tone: 'warn' };
    case 'pass': return { label: 'Đạt', tone: 'ok' };
    case 'extra': return { label: 'Gửi dư', tone: 'info' };
  }
  return { label: '—', tone: 'muted' };
}

/**
 * Trạng thái giao của MỘT đơn trên màn Quản lí đơn.
 *
 * `fulfillmentStatus` là trạng thái fulfill Shopify của store (CEO 29/09/2026):
 * `UNFULFILLED` nghĩa là store chưa xuất đơn — **đơn chưa đi**. Đây là câu hỏi
 * đầu tiên người điều phối cần trả lời, nên nó được một nhãn riêng thay vì lẫn
 * vào "Chưa" / "Chưa ship".
 *
 * NHƯNG bằng chứng của HÃNG thắng trạng thái Shopify khi hai bên mâu thuẫn: đo
 * 28/09 có đơn Shopify để UNFULFILLED trong khi hãng đã giao xong (#MBLVD29788,
 * #MBLVD30230) — fulfill chưa được đẩy lên Shopify chứ hàng đã đi. Hiện "Đơn
 * chưa đi" cho những ca đó là nói sai với người đang điều phối.
 *
 * Nên thứ tự là: sự cố → đã giao → đang chuyển → rồi mới tới trạng thái Shopify.
 */
export function summarizeDelivery(
  o: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number },
  fulfillmentStatus?: string | null,
): Badge {
  // Bằng chứng từ hãng: nói thẳng thứ đang xảy ra, bất kể Shopify ghi gì.
  if (o.packs > 0) {
    if (o.exception > 0) return { label: 'Sự cố', tone: 'bad' };
    if (o.delivered === o.packs) return { label: 'Đã giao', tone: 'ok' };
    if (o.inTransit > 0) return { label: 'Đang chuyển', tone: 'info' };
  }
  // Không có bằng chứng nào từ hãng → tin trạng thái store.
  if (fulfillmentStatus === 'UNFULFILLED') return { label: 'Đơn chưa đi', tone: 'warn' };
  if (o.packs === 0) return { label: 'Chưa', tone: 'muted' };
  if (o.withTracking > 0) return { label: 'Có tracking', tone: 'info' };
  return { label: 'Chưa ship', tone: 'muted' };
}

/** Trạng thái giao theo API track → badge. THUẦN. */
export function formatTrackingStatus(s: string | null): Badge {
  switch (s) {
    case 'delivered': return { label: 'Đã giao', tone: 'ok' };
    case 'label_created': return { label: 'Mới tạo nhãn', tone: 'muted' };
    case 'in_transit':
    case 'out_for_delivery': return { label: 'Đang chuyển', tone: 'info' };
    case 'exception': return { label: 'Sự cố', tone: 'bad' };
    default: return { label: 'Chưa cập nhật', tone: 'muted' };
  }
}

/** URL trang tracking của hãng theo carrierKey. Carrier lạ → '#'. THUẦN. */
export function carrierTrackingUrl(carrierKey: string | null, tracking: string): string {
  const t = encodeURIComponent(tracking);
  if (carrierKey === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (carrierKey === 'dhl') return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${t}`;
  return '#';
}
