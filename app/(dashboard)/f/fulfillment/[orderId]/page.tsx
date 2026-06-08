import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getFulfillmentDetail } from '@/features/fulfillment/queries';
import { OrderDetailPanel } from '@/components/fulfillment/OrderDetailPanel';

export const dynamic = 'force-dynamic';

export default async function FulfillmentDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    redirect('/');
  }

  const detail = await getFulfillmentDetail(orderId);
  if (!detail) notFound();

  return (
    <div className="space-y-6 p-6">
      <OrderDetailPanel
        orderId={orderId}
        status={detail.fulfillment.status}
        lines={detail.lines}
        canManage={hasPermission(role, 'manage_fulfillment')}
      />
    </div>
  );
}
