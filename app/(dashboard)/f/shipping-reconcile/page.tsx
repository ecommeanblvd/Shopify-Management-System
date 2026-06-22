import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { reconcileShipmentsWithStatus, pdfBillByShipment } from '@/features/shipments/reconcile-view';
import { filterReconcileRows, reconcileSummary, paginate, countByEffStatus, type ReconcileFilters } from '@/features/shipments/reconcile-filter';
import { listIssueReports } from '@/features/shipments/issue-report-actions';
import { listCarrierErrors, summariseCarrierErrors } from '@/features/shipments/carrier-error-report';
import { listInternalErrors, summariseInternalErrors } from '@/features/shipments/internal-error-report';
import { listUnmatchedBilledTracking, summariseUnmatched } from '@/features/shipments/unmatched-billed';
import { issueInfo } from '@/components/shipping-reconcile/issue-label';
import { ReconcileTable } from '@/components/shipping-reconcile/ReconcileTable';
import { UnmatchedBilledBanner } from '@/components/shipping-reconcile/UnmatchedBilledBanner';
import type { OpenIssue } from '@/components/shipping-reconcile/ReconcileIssuesModal';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

type SP = { refresh?: string; carrier?: string; status?: string; country?: string; minPct?: string; q?: string; page?: string };

export default async function ShippingReconcilePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    redirect('/');
  }

  const [{ rows, computedAt }, reports, carrierErrors, unmatchedBilled] = await Promise.all([
    reconcileShipmentsWithStatus({ forceRecompute: sp.refresh === '1' }),
    listIssueReports(),
    listCarrierErrors(),
    listUnmatchedBilledTracking(),
  ]);
  const carrierErrorGroups = summariseCarrierErrors(carrierErrors.filter((r) => r.state === 'approved'));
  const internalErrors = await listInternalErrors();
  const internalErrorGroups = summariseInternalErrors(internalErrors);

  // Lọc + summary + phân trang PHÍA SERVER (chỉ gửi trang đang xem xuống client).
  const filters: ReconcileFilters = {
    carrier: (sp.carrier === 'fedex' || sp.carrier === 'dhl') ? sp.carrier : 'all',
    status: (['pending', 'reconciled', 'ignored', 'carrier_error', 'disputing', 'internal_error', 'credited', 'accepted', 'awaiting_measurement', 'awaiting_billed'] as const).includes(sp.status as never)
      ? (sp.status as ReconcileFilters['status']) : 'all',
    country: sp.country ?? '', minPct: sp.minPct ?? '', q: sp.q ?? '',
  };
  const filteredRows = filterReconcileRows(rows, filters);
  const summary = reconcileSummary(filteredRows);
  const effCounts = countByEffStatus(filteredRows);
  const preBilledCounts = { awaiting_measurement: effCounts.awaiting_measurement, awaiting_billed: effCounts.awaiting_billed };
  const { pageRows, totalPages, safePage } = paginate(filteredRows, Number(sp.page ?? 0) || 0, PAGE_SIZE);
  const pdfMap = await pdfBillByShipment(pageRows.map((r) => r.shipmentId));

  // "Vấn đề & Report" mở: gom đơn PENDING có vấn đề trên TOÀN BỘ rows (không phải trang).
  const groups = new Map<string, OpenIssue>();
  for (const r of rows) {
    if (r.status !== 'pending') continue;
    const info = issueInfo(r);
    if (!info.groupKey || !info.action) continue;
    const g = groups.get(info.groupKey) ?? { groupKey: info.groupKey, carrierKey: r.carrierKey || null, label: info.label, action: info.action, count: 0, sumDelta: 0, samples: [] };
    g.count += 1;
    g.sumDelta += r.deltaVnd ?? 0;
    if (g.samples.length < 4) g.samples.push(r.orderNumber);
    groups.set(info.groupKey, g);
  }
  const openIssues = [...groups.values()].sort((a, b) => Math.abs(b.sumDelta) - Math.abs(a.sumDelta));

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
      <UnmatchedBilledBanner rows={unmatchedBilled} summary={summariseUnmatched(unmatchedBilled)} />
      <ReconcileTable
        rows={pageRows} summary={summary} totalPages={totalPages} safePage={safePage} totalFiltered={filteredRows.length}
        filters={filters} openIssues={openIssues}
        reports={reports} carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups} internalErrorGroups={internalErrorGroups}
        pdfMap={pdfMap} preBilledCounts={preBilledCounts}
      />
    </div>
  );
}
