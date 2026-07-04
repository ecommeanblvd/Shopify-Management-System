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

  const [detail, brandRequests, packs, mmp, larkRecords] = await Promise.all([
    getFulfillmentDetail(orderId),
    listBrandRequestsForOrder(orderId),
    listPacksForOrder(orderId),
    getMmpPushInfo(orderId),
    larkSafe,
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

  // qcPassAt có giá trị → KCS đã pass.
  const larkQc = lifecycle.qcPassAt != null ? 'pass' : null;

  // allInStock: mọi line đã gán warehouseCode (tức đã pick từ kho).
  const lines = detail?.lines ?? [];
  const allInStock = lines.length > 0 && lines.every((l) => (l.warehouseCode ?? null) != null);

  const signals: StageSignals = {
    pushedMmp: mmp?.status === 'sent',
    larkQc,
    larkDispatch: null, // Lark dispatch chỉ dùng trong lifecycle list — không cần ở đây
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
