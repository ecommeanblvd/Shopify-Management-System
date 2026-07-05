/** GET /api/customer-account/orders/[orderId]/journey — timeline + policy + requests của 1 đơn. */
import { type NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { authenticateExtension, caJson, preflight } from '../../../_shared';
import { getOrderJourney } from '@/features/customer-account/order-requests';
import { toPublicTimeline } from '@/features/customer-account/public-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReturnHubView {
  label: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
}

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const { orderId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return caJson({ error: 'bad id' }, 400);

  const journey = await getOrderJourney(auth.store.id, auth.customerId, orderId);
  if (!journey) return caJson({ error: 'not found' }, 404);
  const { order, policy, requests } = journey;

  const hubIds = [...new Set(requests.map((r) => r.returnHubId).filter((id): id is string => !!id))];
  const hubs = hubIds.length
    ? await db.select().from(schema.returnHubs).where(inArray(schema.returnHubs.id, hubIds))
    : [];
  const hubById = new Map(hubs.map((h) => [h.id, h]));
  const toReturnHubView = (id: string | null): ReturnHubView | null => {
    if (!id) return null;
    const h = hubById.get(id);
    if (!h) return null;
    return {
      label: h.label,
      recipientName: h.recipientName,
      addressLine1: h.addressLine1,
      addressLine2: h.addressLine2,
      city: h.city,
      state: h.state,
      postalCode: h.postalCode,
      country: h.country,
      phone: h.phone,
    };
  };

  return caJson({
    order: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.totalPrice,
      currency: order.currency,
    },
    timeline: order.lc ? toPublicTimeline(order.lc) : null,
    productionEta: order.lc?.productionEta ?? null,
    policy: {
      canCancel: policy.canCancel,
      canClaim: policy.canClaim,
      claimDeadline: policy.claimDeadline ? policy.claimDeadline.toISOString() : null,
      refundPercent: policy.refundPercent,
      refundAmount: policy.refundAmount,
      feeAmount: policy.feeAmount,
    },
    requests: requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      reasonCodes: r.reasonCodes,
      createdAt: r.createdAt.toISOString(),
      refundAmount: r.refundAmount,
      currency: r.currency,
      returnHub: toReturnHubView(r.returnHubId),
      returnShippingPayer: r.returnShippingPayer,
      returnTrackingNumber: r.returnTrackingNumber,
      returnCarrier: r.returnCarrier,
      rejectedReason: r.rejectedReason,
    })),
  });
}
