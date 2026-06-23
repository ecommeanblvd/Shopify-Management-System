import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listBrandRequests } from '@/features/fulfillment/brand-queries';
import { countOverdueFollowUps } from '@/features/fulfillment/brand-logic';
import { BrandRequestsTable } from '@/components/fulfillment/BrandRequestsTable';
import { BrandOverdueBanner } from '@/components/fulfillment/BrandOverdueBanner';

export const dynamic = 'force-dynamic';

export default async function BrandRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    redirect('/');
  }

  const sp = await searchParams;
  const defaultFollowUp = sp['followup'] === '1';

  const rows = await listBrandRequests();
  const overdue = countOverdueFollowUps(
    rows.map((r) => ({
      confirmStatus: r.confirmStatus,
      expectedDeliveryDate: r.expectedDeliveryDate,
      deliveredAt: r.deliveredAt,
    })),
    new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Yêu cầu brand</h1>
          <p className="text-sm text-muted-foreground">
            Danh sách các yêu cầu đặt hàng gửi tới brand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/f/fulfillment"
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Vận hành đơn
          </Link>
        </div>
      </div>
      <BrandOverdueBanner count={overdue} />
      <BrandRequestsTable
        rows={rows}
        canManage={hasPermission(role, 'manage_fulfillment')}
        defaultFollowUp={defaultFollowUp}
      />
    </div>
  );
}
