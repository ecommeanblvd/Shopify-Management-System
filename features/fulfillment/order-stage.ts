/**
 * Suy ra "stage" vòng đời đơn để hiển thị ở cột Tình trạng — THUẦN, từ tín hiệu
 * THẬT (MMP push, KCS Lark, agg shipments đã auto-track, tồn kho). Thay cho
 * `order_fulfillment.status` (rollup từ line kho gần như không dùng → luôn kẹt).
 * Đánh giá xa-nhất-trước: chặng sau ghi đè chặng trước.
 */

export type StageKey =
  | 'awaiting_brand_order' | 'pick_warehouse' | 'brand_notified'
  | 'kcs_pending' | 'kcs_failed' | 'ready_to_pack' | 'packed'
  | 'shipped' | 'out_for_delivery' | 'delivered' | 'exception';

export type StageTone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

export interface StageSignals {
  /** Đã đẩy MMP thành công (mmp_order_pushes.status='sent'). */
  pushedMmp: boolean;
  /** KCS từ Lark: pass|fail|pending|extra|null. Có giá trị ⇒ brand đã gửi hàng về. */
  larkQc: string | null;
  /** Trạng thái carrier từ Lark (fallback khi auto-track chưa kịp). */
  larkDispatch: string | null;
  ship: {
    packs: number; withTracking: number; delivered: number;
    exception: number; inTransit: number; outForDelivery: number;
  };
  /** Mọi SKU của đơn còn tồn kho hệ thống (best-effort, kho nhập tay). */
  allInStock: boolean;
}

export interface OrderStage { key: StageKey; label: string; tone: StageTone }

const LARK_DELIVERED = 'Delivery Completed';
const LARK_OUT_FOR_DELIVERY = 'On Delivery';
const LARK_EXCEPTIONS = new Set([
  'Return-Processing', 'Package Lost', 'Delivery Attempt Failed', 'Cancel at Cnee Country',
]);

const STAGE: Record<StageKey, Omit<OrderStage, 'key'>> = {
  awaiting_brand_order: { label: 'Chờ đặt brand', tone: 'muted' },
  pick_warehouse: { label: 'Lấy từ kho', tone: 'warn' },
  brand_notified: { label: 'Đã báo brand', tone: 'info' },
  kcs_pending: { label: 'Brand gửi · chờ KCS', tone: 'warn' },
  kcs_failed: { label: 'KCS lỗi', tone: 'bad' },
  ready_to_pack: { label: 'Chờ đóng gói', tone: 'warn' },
  packed: { label: 'Đã đóng gói', tone: 'info' },
  shipped: { label: 'Đã ship · đang chuyển', tone: 'info' },
  out_for_delivery: { label: 'Đang giao', tone: 'info' },
  delivered: { label: 'Hoàn tất', tone: 'ok' },
  exception: { label: 'Sự cố', tone: 'bad' },
};

const mk = (key: StageKey): OrderStage => ({ key, ...STAGE[key] });

export function deriveOrderStage(s: StageSignals): OrderStage {
  const { ship } = s;
  // 1. Hoàn tất — mọi kiện đã giao, hoặc Lark báo Delivery Completed.
  if ((ship.packs > 0 && ship.delivered === ship.packs) || s.larkDispatch === LARK_DELIVERED) return mk('delivered');
  // 2. Sự cố.
  if (ship.exception > 0 || (s.larkDispatch != null && LARK_EXCEPTIONS.has(s.larkDispatch))) return mk('exception');
  // 3. Đang giao (out for delivery).
  if (ship.outForDelivery > 0 || s.larkDispatch === LARK_OUT_FOR_DELIVERY) return mk('out_for_delivery');
  // 4. Đã ship — có tracking / đang chuyển.
  if (ship.inTransit > 0 || ship.withTracking > 0) return mk('shipped');
  // 5. Đã đóng gói — có kiện nhưng chưa lên vận đơn.
  if (ship.packs > 0) return mk('packed');
  // 6-8. KCS (có KCS ⇒ brand đã gửi hàng về).
  if (s.larkQc === 'pass') return mk('ready_to_pack');
  if (s.larkQc === 'fail') return mk('kcs_failed');
  if (s.larkQc === 'pending' || s.larkQc === 'extra') return mk('kcs_pending');
  // 9. Đã báo brand.
  if (s.pushedMmp) return mk('brand_notified');
  // 10. Lấy từ kho (còn tồn), 11. mặc định chờ đặt brand.
  if (s.allInStock) return mk('pick_warehouse');
  return mk('awaiting_brand_order');
}

/** Danh sách stage cho bộ lọc UI (đúng thứ tự vòng đời). */
export const STAGE_ORDER: StageKey[] = [
  'awaiting_brand_order', 'pick_warehouse', 'brand_notified', 'kcs_pending',
  'kcs_failed', 'ready_to_pack', 'packed', 'shipped', 'out_for_delivery',
  'delivered', 'exception',
];
export const stageLabel = (k: StageKey): string => STAGE[k].label;
