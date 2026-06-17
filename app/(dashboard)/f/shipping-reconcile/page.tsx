import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';
import { listIssueReports } from '@/features/shipments/issue-report-actions';
import { listCarrierErrors, summariseCarrierErrors } from '@/features/shipments/carrier-error-report';
import { listInternalErrors, summariseInternalErrors } from '@/features/shipments/internal-error-report';
import { ReconcileTable } from '@/components/shipping-reconcile/ReconcileTable';

export const dynamic = 'force-dynamic';

export default async function ShippingReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    redirect('/');
  }

  const [{ rows, computedAt }, reports, carrierErrors] = await Promise.all([
    reconcileShipmentsWithStatus({ forceRecompute: sp.refresh === '1' }),
    listIssueReports(),
    listCarrierErrors(),
  ]);
  const carrierErrorGroups = summariseCarrierErrors(carrierErrors.filter((r) => r.state === 'approved'));
  const internalErrors = await listInternalErrors();
  const internalErrorGroups = summariseInternalErrors(internalErrors);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Đối soát phí ship</h1>
        <p className="text-sm text-muted-foreground">
          So giá hóa đơn carrier (billed) với giá hệ thống tính, theo từng đơn và từng khoản phí.
          {' '}Số liệu engine tính lúc {computedAt.toLocaleTimeString('vi-VN')}
          {' · '}
          <a href="/f/shipping-reconcile?refresh=1" className="underline hover:text-foreground">Tính lại</a>
        </p>
      </div>
      {internalErrorGroups.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="mb-1.5 font-medium text-amber-700 dark:text-amber-400">
            ⚠ Lỗi nội bộ (sai cân/dim — sửa data, không đòi carrier)
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
            {internalErrorGroups.map((g) => (
              <span key={g.carrierKey ?? '?'}>
                <span className="uppercase font-mono">{g.carrierKey ?? '—'}</span>: {g.count} đơn ·{' '}
                <span className={g.sumDeltaVnd > 0 ? 'text-red-600 dark:text-red-400' : g.sumDeltaVnd < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}>
                  {Math.round(g.sumDeltaVnd).toLocaleString('vi-VN')}đ
                </span>
              </span>
            ))}
            <span className="font-medium text-foreground">
              Tổng: {internalErrorGroups.reduce((s, g) => s + g.count, 0)} đơn ·{' '}
              {Math.round(internalErrorGroups.reduce((s, g) => s + g.sumDeltaVnd, 0)).toLocaleString('vi-VN')}đ
            </span>
          </div>
        </div>
      )}
      <ReconcileTable rows={rows} reports={reports} carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups} />
    </div>
  );
}
