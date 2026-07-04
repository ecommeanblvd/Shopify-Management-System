import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWorklistStatus } from '@/features/fulfillment/worklist-status-queries';
import { summarizeAddr, summarizeKcs, summarizeDelivery } from '@/features/fulfillment/worklist-status';
import { listBrandRequests } from '@/features/fulfillment/brand-queries';
import { countOverdueFollowUps } from '@/features/fulfillment/brand-logic';
import { WorklistTable } from '@/components/fulfillment/WorklistTable';
import { BackfillButton } from '@/components/fulfillment/BackfillButton';
import { MmpBackfillButton } from '@/components/fulfillment/MmpBackfillButton';
import { BrandOverdueBanner } from '@/components/fulfillment/BrandOverdueBanner';
import { OrderTabs } from '@/components/orders/OrderTabs';

export const dynamic = 'force-dynamic';

export default async function FulfillmentWorklistPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    redirect('/');
  }

  const [worklistStatusRows, brandRows] = await Promise.all([
    listWorklistStatus(),
    listBrandRequests(),
  ]);

  const worklistRows = worklistStatusRows.map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    storeName: r.storeName,
    status: r.status,
    stage: r.stage,
    createdAtShopify: r.createdAtShopify,
    editedAt: r.editedAt,
    editedAfterFulfilledAt: r.editedAfterFulfilledAt,
    updatedAtShopify: r.updatedAtShopify,
    addr: summarizeAddr(r),
    kcs: summarizeKcs(r.kcs, r.larkQc),
    delivery: summarizeDelivery(r.ship),
    packs: r.ship.packs,
    tracks: r.ship.tracks,
    lark: r.lark,
  }));

  const overdue = countOverdueFollowUps(
    brandRows.map((r) => ({
      confirmStatus: r.confirmStatus,
      expectedDeliveryDate: r.expectedDeliveryDate,
      deliveredAt: r.deliveredAt,
    })),
    new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-6 p-6">
      <OrderTabs />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Vận hành đơn</h1>
          <p className="text-sm text-muted-foreground">
            Danh sách đơn hàng cần xử lý kho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission(role, 'manage_fulfillment') && <BackfillButton />}
          {hasPermission(role, 'manage_fulfillment') && <MmpBackfillButton />}
          <Link
            href="/f/fulfillment/brand-requests"
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Yêu cầu brand
          </Link>
        </div>
      </div>
      <BrandOverdueBanner count={overdue} />
      <WorklistTable
        rows={worklistRows}
        canManage={hasPermission(role, 'manage_fulfillment')}
      />
    </div>
  );
}
