import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listBrandRequests } from '@/features/fulfillment/brand-queries';
import { BrandRequestsTable } from '@/components/fulfillment/BrandRequestsTable';

export const dynamic = 'force-dynamic';

export default async function BrandRequestsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    redirect('/');
  }

  const rows = await listBrandRequests();

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
      <BrandRequestsTable
        rows={rows}
        canManage={hasPermission(role, 'manage_fulfillment')}
      />
    </div>
  );
}
