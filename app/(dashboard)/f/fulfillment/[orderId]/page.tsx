import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getFulfillmentDetail } from '@/features/fulfillment/queries';
import { listPacksForOrder, pickedUnassignedLines } from '@/features/packing/queries';
import { OrderDetailPanel } from '@/components/fulfillment/OrderDetailPanel';
import { AddressVerifyCard } from '@/components/fulfillment/AddressVerifyCard';
import { AddressVerifyButton } from '@/components/fulfillment/AddressVerifyButton';
import { PackPanel } from '@/components/fulfillment/PackPanel';
import { getMmpPushInfo } from '@/features/mmp/order-push-query';
import { MmpPushBadge } from '@/components/fulfillment/MmpPushBadge';

export const dynamic = 'force-dynamic';

export default async function FulfillmentDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');

  const detail = await getFulfillmentDetail(orderId);
  if (!detail) notFound();
  const [picked, packs] = await Promise.all([pickedUnassignedLines(orderId), listPacksForOrder(orderId)]);

  const canManage = hasPermission(role, 'manage_fulfillment');
  const mmpPush = await getMmpPushInfo(orderId);
  return (
    <div className="space-y-6 p-6">
      <OrderDetailPanel orderId={orderId} status={detail.fulfillment.status} lines={detail.lines} canManage={canManage} />
      <MmpPushBadge info={mmpPush} orderId={orderId} canManage={canManage} />
      <AddressVerifyCard address={detail.address} />
      <AddressVerifyButton orderId={orderId} />
      <PackPanel
        orderId={orderId}
        picked={picked}
        packs={packs.map((p) => ({
          id: p.id, code: p.code, carrierKey: p.carrierKey, trackingNumber: p.trackingNumber,
          checkPackedAt: p.checkPackedAt as Date | null, actualWeightKg: p.actualWeightKg,
          lines: p.lines.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty, status: l.status, productTitle: l.productTitle })),
          shopifyPushStatus: p.shopifyPushStatus, shopifyPushError: p.shopifyPushError,
        }))}
        canManage={canManage}
        canCheckPacked={hasPermission(role, 'check_packed')}
      />
    </div>
  );
}
