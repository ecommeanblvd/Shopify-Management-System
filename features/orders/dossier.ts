import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLifecycle } from '@/features/lifecycle/queries';
import { getFulfillmentDetail } from '@/features/fulfillment/queries';
import { listBrandRequestsForOrder } from '@/features/fulfillment/brand-queries';
import { listPacksForOrder } from '@/features/packing/queries';
import { getMmpPushInfo } from '@/features/mmp/order-push-query';
import { getLarkRecordsForOrder } from '@/features/lark/detail';
import { deriveOrderStage, type StageSignals, type OrderStage } from '@/features/fulfillment/order-stage';

type Lifecycle = NonNullable<Awaited<ReturnType<typeof getLifecycle>>>;
type FulfillmentDetail = Awaited<ReturnType<typeof getFulfillmentDetail>>;
type Pack = Awaited<ReturnType<typeof listPacksForOrder>>[number];
type BrandReq = Awaited<ReturnType<typeof listBrandRequestsForOrder>>[number];
type LarkRecord = Awaited<ReturnType<typeof getLarkRecordsForOrder>>[number];

export interface OrderDossier {
  lifecycle: Lifecycle;
  address: NonNullable<FulfillmentDetail>['address'] | null;
  lines: NonNullable<FulfillmentDetail>['lines'];
  brandRequests: BrandReq[];
  packs: Pack[];
  larkRecords: LarkRecord[];
  /** Tình trạng hiện tại của đơn — suy ra từ StageSignals thực tế. */
  currentAction: OrderStage;
}

export async function getOrderDossier(orderId: string): Promise<OrderDossier | null> {
  const lifecycle = await getLifecycle(orderId);
  if (!lifecycle) return null;

  // Lark best-effort: hàm đã có try/catch nội bộ nhưng thêm .catch ngoài cho chắc.
  const larkSafe = getLarkRecordsForOrder(orderId).catch((): LarkRecord[] => []);

  const larkStatusSafe = db
    .select({ qcStatus: schema.larkOrderStatus.qcStatus, dispatchStatus: schema.larkOrderStatus.dispatchStatus })
    .from(schema.larkOrderStatus)
    .where(eq(schema.larkOrderStatus.orderId, orderId))
    .then((rows) => rows[0] ?? null)
    .catch(() => null);

  const [detail, brandRequests, packs, mmp, larkRecords, larkRow] = await Promise.all([
    getFulfillmentDetail(orderId),
    listBrandRequestsForOrder(orderId),
    listPacksForOrder(orderId),
    getMmpPushInfo(orderId),
    larkSafe,
    larkStatusSafe,
  ]);

  // Build StageSignals cho "việc hiện tại".
  const ship: StageSignals['ship'] = {
    packs: packs.length,
    withTracking: packs.filter((p) => p.trackingNumber != null).length,
    delivered: packs.filter((p) => p.deliveryStatus === 'delivered').length,
    exception: packs.filter((p) => p.deliveryStatus === 'exception').length,
    inTransit: packs.filter((p) => p.deliveryStatus === 'in_transit').length,
    outForDelivery: packs.filter((p) => p.deliveryStatus === 'out_for_delivery').length,
  };

  // Lấy qcStatus / dispatchStatus thật từ larkOrderStatus (pass/fail/pending/extra).
  const larkQc = larkRow?.qcStatus ?? null;
  const larkDispatch = larkRow?.dispatchStatus ?? null;

  // allInStock: xấp xỉ: đã pick/gán kho, không phải tồn-theo-SKU (canonical); đủ cho pill
  const lines = detail?.lines ?? [];
  const allInStock = lines.length > 0 && lines.every((l) => (l.warehouseCode ?? null) != null);

  const signals: StageSignals = {
    pushedMmp: mmp?.status === 'sent',
    larkQc,
    larkDispatch,
    ship,
    allInStock,
  };

  const currentAction = deriveOrderStage(signals);

  return {
    lifecycle,
    address: detail?.address ?? null,
    lines,
    brandRequests,
    packs,
    larkRecords,
    currentAction,
  };
}
