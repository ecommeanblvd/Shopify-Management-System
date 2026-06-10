import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';
import { listIssueReports } from '@/features/shipments/issue-report-actions';
import { ReconcileTable } from '@/components/shipping-reconcile/ReconcileTable';

export const dynamic = 'force-dynamic';

export default async function ShippingReconcilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    redirect('/');
  }

  const [{ rows }, reports] = await Promise.all([
    reconcileShipmentsWithStatus(),
    listIssueReports(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Đối soát phí ship</h1>
        <p className="text-sm text-muted-foreground">
          So giá hóa đơn carrier (billed) với giá hệ thống tính, theo từng đơn và từng khoản phí.
        </p>
      </div>
      <ReconcileTable rows={rows} reports={reports} />
    </div>
  );
}
