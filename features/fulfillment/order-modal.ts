'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getFulfillmentDetail } from './queries';
import { listPacksForOrder } from '@/features/packing/queries';
import { getLarkRawFieldsForOrder, pickLarkFields, LARK_DETAIL_FIELDS } from '@/features/lark/detail';

export interface OrderModalData {
  summary: {
    orderNumber: string | null;
    storeName: string | null;
    createdAtShopify: string | null;
    status: string;
    address: { line: string | null; deliverable: boolean | null; verifiedAt: string | null } | null;
    lines: Array<{ sku: string | null; qty: number; status: string; productTitle: string | null }>;
    packs: Array<{ code: string | null; carrierKey: string | null; trackingNumber: string | null; deliveryStatus: string | null; deliveredAt: string | null; weightKg: string | null }>;
  } | null;
  larkFields: Array<{ label: string; value: string }>;
}

export async function getOrderDetailModal(orderId: string): Promise<OrderModalData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { summary: null, larkFields: [] };
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) return { summary: null, larkFields: [] };

  const detail = await getFulfillmentDetail(orderId);
  if (!detail) return { summary: null, larkFields: [] };

  const [ord] = await db
    .select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      storeName: schema.stores.name,
      createdAtShopify: schema.shopifyOrders.createdAtShopify,
    })
    .from(schema.shopifyOrders)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId))
    .limit(1);

  const a = detail.address;
  const address = a
    ? {
        line: [a.name, a.line1, a.line2, a.city, a.province, a.country].filter(Boolean).join(', ') || null,
        deliverable: a.addrDeliverable,
        verifiedAt: a.addrVerifiedAt ? a.addrVerifiedAt.toISOString() : null,
      }
    : null;

  const packsRaw = await listPacksForOrder(orderId);
  const packs = packsRaw.map((p) => ({
    code: p.code,
    carrierKey: p.carrierKey,
    trackingNumber: p.trackingNumber,
    deliveryStatus: p.deliveryStatus,
    deliveredAt: p.deliveredAt ? (p.deliveredAt as Date).toISOString() : null,
    weightKg: p.actualWeightKg,
  }));

  const rawFields = await getLarkRawFieldsForOrder(orderId);

  return {
    summary: {
      orderNumber: ord?.orderNumber ?? null,
      storeName: ord?.storeName ?? null,
      createdAtShopify: ord?.createdAtShopify ? ord.createdAtShopify.toISOString() : null,
      status: detail.fulfillment.status,
      address,
      lines: detail.lines.map((l) => ({ sku: l.sku, qty: l.qty, status: l.status, productTitle: l.productTitle ?? null })),
      packs,
    },
    larkFields: pickLarkFields(rawFields, LARK_DETAIL_FIELDS),
  };
}
