/**
 * THUẦN (không I/O): suy ra snapshot vòng đời đơn từ tín hiệu nguồn đã flatten
 * (spec §3 stage machine + §4 SLA/delay). Orchestrator `sync.ts` lo query/upsert.
 *
 * Nguyên tắc:
 *  - Stage = mốc xa nhất đã đạt (đơn nhiều kiện: theo kiện chậm nhất).
 *  - First-seen stamps (qcPass/inTransit/outForDelivery/returnProcessing, fallback
 *    shipped/delivered): chỉ set khi prev null — không ghi đè.
 *  - exception là CỜ, không phải stage; tự hạ khi hết tín hiệu xấu.
 *  - completed = deliveredAt + 30 ngày, không có Return-Processing đang chạy.
 */

export type StageKey =
  | 'placed' | 'production' | 'qc' | 'packed' | 'shipped'
  | 'in_transit' | 'out_for_delivery' | 'post_delivery'
  | 'completed' | 'refunded_full' | 'cancelled';

export type SlaKey = 'placed_to_production' | 'production' | 'qc' | 'pack' | 'ship' | 'deliver';
export type DelayStatus = 'on_track' | 'due_soon' | 'overdue';

export const DEFAULT_SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};

const H = 3600_000;
const COMPLETED_WINDOW_MS = 30 * 24 * H;
/** Lark dispatch coi là sự cố khi CHƯA delivered. */
const EXCEPTION_DISPATCH = ['Return-Processing', 'Package Lost', 'Delivery Attempt Failed'];

export interface LifecycleSignals {
  placedAt: Date | null;
  cancelledAt: Date | null;
  financialStatus: string | null;
  mmpSentAt: Date | null;
  brandConfirmedAt: Date | null;
  brandEta: string | null; // 'YYYY-MM-DD' (max các request)
  brandRequestCount: number;
  brandDeliveredCount: number;
  brandDeliveredMaxAt: Date | null;
  larkQc: string | null;
  larkDispatch: string | null;
  packedMinAt: Date | null;
  labelMinAt: Date | null;
  hasTracking: boolean;
  packs: number;
  packsDelivered: number;
  packsException: number;
  anyInTransit: boolean;
  anyOutForDelivery: boolean;
  shipDeliveredMaxAt: Date | null;
  refundFirstAt: Date | null;
}

/** Stamps đã có từ snapshot trước (giữ first-seen). */
export interface LifecyclePrev {
  qcPassAt: Date | null;
  inTransitAt: Date | null;
  outForDeliveryAt: Date | null;
  returnProcessingAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
}

export interface LifecycleSnapshot {
  currentStage: StageKey;
  exception: boolean;
  exceptionNote: string | null;
  placedAt: Date | null;
  productionStartAt: Date | null;
  productionConfirmedAt: Date | null;
  productionEta: string | null;
  goodsReceivedAt: Date | null;
  qcPassAt: Date | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  inTransitAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  returnProcessingAt: Date | null;
  refundedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  deadline: Date | null;
  delayStatus: DelayStatus;
  delayHours: number;
}

export function deriveLifecycle(
  sig: LifecycleSignals,
  prev: LifecyclePrev | null,
  sla: Record<SlaKey, number>,
  now: Date,
): LifecycleSnapshot {
  // --- Mốc (kèm first-seen từ prev) ---
  const goodsReceivedAt =
    sig.brandRequestCount > 0 && sig.brandDeliveredCount === sig.brandRequestCount
      ? sig.brandDeliveredMaxAt : null;
  const qcPassAt = prev?.qcPassAt ?? (sig.larkQc === 'pass' ? now : null);
  const packedAt = sig.packedMinAt;
  const shippedAt = sig.labelMinAt ?? prev?.shippedAt ?? (sig.hasTracking ? now : null);
  const inTransitAt = prev?.inTransitAt ?? (sig.anyInTransit ? now : null);
  const outForDeliveryAt = prev?.outForDeliveryAt ?? (sig.anyOutForDelivery ? now : null);
  const allPacksDelivered = sig.packs > 0 && sig.packsDelivered === sig.packs;
  const larkDelivered = sig.larkDispatch === 'Delivery Completed';
  const deliveredAt = allPacksDelivered
    ? sig.shipDeliveredMaxAt
    : prev?.deliveredAt ?? (larkDelivered ? now : null);
  const returning = sig.larkDispatch === 'Return-Processing';
  const returnProcessingAt = prev?.returnProcessingAt ?? (returning && deliveredAt ? now : null);

  // --- Terminal + stage (ưu tiên giảm dần) ---
  let currentStage: StageKey;
  let completedAt: Date | null = prev?.completedAt ?? null;
  if (sig.cancelledAt) currentStage = 'cancelled';
  else if (sig.financialStatus === 'refunded') currentStage = 'refunded_full';
  else if (deliveredAt && now.getTime() >= deliveredAt.getTime() + COMPLETED_WINDOW_MS && !returning) {
    currentStage = 'completed';
    completedAt = completedAt ?? new Date(deliveredAt.getTime() + COMPLETED_WINDOW_MS);
  } else if (deliveredAt) currentStage = 'post_delivery';
  else if (outForDeliveryAt) currentStage = 'out_for_delivery';
  else if (inTransitAt) currentStage = 'in_transit';
  else if (shippedAt) currentStage = 'shipped';
  else if (packedAt) currentStage = 'packed';
  else if (goodsReceivedAt || qcPassAt) currentStage = 'qc';
  else if (sig.mmpSentAt) currentStage = 'production';
  else currentStage = 'placed';

  // --- Exception (cờ, tự hạ) ---
  const badDispatch = !deliveredAt && sig.larkDispatch != null && EXCEPTION_DISPATCH.includes(sig.larkDispatch);
  const exception = sig.packsException > 0 || badDispatch;
  const exceptionNote = exception
    ? (sig.packsException > 0 ? `${sig.packsException} kiện exception` : sig.larkDispatch)
    : null;

  // --- Deadline theo stage (spec §4) ---
  let anchor: Date | null = null;
  let deadline: Date | null = null;
  if (currentStage === 'placed' && sig.placedAt) {
    anchor = sig.placedAt;
    deadline = new Date(anchor.getTime() + sla.placed_to_production * H);
  } else if (currentStage === 'production' && sig.mmpSentAt) {
    anchor = sig.mmpSentAt;
    deadline = sig.brandEta
      ? new Date(`${sig.brandEta}T23:59:59.000Z`)
      : new Date(anchor.getTime() + sla.production * H);
  } else if (currentStage === 'qc') {
    if (!qcPassAt && goodsReceivedAt) {
      anchor = goodsReceivedAt;
      deadline = new Date(anchor.getTime() + sla.qc * H);
    } else if (qcPassAt) {
      anchor = qcPassAt;
      deadline = new Date(anchor.getTime() + sla.pack * H);
    }
  } else if (currentStage === 'packed' && packedAt) {
    anchor = packedAt;
    deadline = new Date(anchor.getTime() + sla.ship * H);
  } else if ((currentStage === 'shipped' || currentStage === 'in_transit' || currentStage === 'out_for_delivery') && shippedAt) {
    anchor = shippedAt;
    deadline = new Date(anchor.getTime() + sla.deliver * H);
  }
  // post_delivery / terminal: không deadline.

  // --- Delay ---
  let delayStatus: DelayStatus = 'on_track';
  let delayHours = 0;
  if (deadline && anchor) {
    if (now.getTime() > deadline.getTime()) {
      delayStatus = 'overdue';
      delayHours = Math.ceil((now.getTime() - deadline.getTime()) / H);
    } else {
      const ratio = (now.getTime() - anchor.getTime()) / (deadline.getTime() - anchor.getTime());
      if (ratio >= 0.8) delayStatus = 'due_soon';
    }
  }

  return {
    currentStage, exception, exceptionNote,
    placedAt: sig.placedAt,
    productionStartAt: sig.mmpSentAt,
    productionConfirmedAt: sig.brandConfirmedAt,
    productionEta: sig.brandEta,
    goodsReceivedAt, qcPassAt, packedAt, shippedAt, inTransitAt, outForDeliveryAt,
    deliveredAt, returnProcessingAt,
    refundedAt: sig.refundFirstAt,
    completedAt, cancelledAt: sig.cancelledAt,
    deadline, delayStatus, delayHours,
  };
}
