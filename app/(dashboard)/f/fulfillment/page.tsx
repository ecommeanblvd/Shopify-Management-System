import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listFulfillmentWorklist } from '@/features/fulfillment/queries';
import { WorklistTable } from '@/components/fulfillment/WorklistTable';
import { BackfillButton } from '@/components/fulfillment/BackfillButton';

export const dynamic = 'force-dynamic';

export default async function FulfillmentWorklistPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    redirect('/');
  }

  const rows = await listFulfillmentWorklist();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Vận hành đơn</h1>
          <p className="text-sm text-muted-foreground">
            Danh sách đơn hàng cần xử lý kho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission(role, 'manage_fulfillment') && <BackfillButton />}
          <Link
            href="/f/fulfillment/brand-requests"
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Yêu cầu brand
          </Link>
        </div>
      </div>
      <WorklistTable
        rows={rows}
        canManage={hasPermission(role, 'manage_fulfillment')}
      />
    </div>
  );
}
