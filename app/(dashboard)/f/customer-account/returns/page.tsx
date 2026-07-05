import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PackageCheck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listStoresBasic } from '@/features/customer-account/admin-queries';
import { listAdminReturns, RETURN_STATUSES } from '@/features/customer-account/returns-admin';
import { ReturnsTable } from './ReturnsTable';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ store?: string; status?: string }>;
}

export default async function ReturnsQueuePage({ searchParams }: PageProps): Promise<React.ReactNode> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }
  const canManage = hasPermission(role, 'manage_functions');

  const stores = await listStoresBasic();
  const sp = await searchParams;
  const storeId = sp.store && stores.some((s) => s.id === sp.store) ? sp.store : undefined;
  const status = sp.status && RETURN_STATUSES.includes(sp.status as (typeof RETURN_STATUSES)[number])
    ? sp.status
    : undefined;

  const returns = await listAdminReturns({ storeId, status });

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <PackageCheck className="size-3.5" />
          Customer Account
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Returns queue
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Duyệt các yêu cầu đổi/trả khách gửi từ trang tài khoản: đổi trạng thái
          (requested → approved/rejected → received → refunded) và ghi chú nội bộ.
        </p>
      </header>

      <ReturnsTable
        stores={stores}
        returns={returns}
        activeStoreId={storeId ?? ''}
        activeStatus={status ?? ''}
        canManage={canManage}
      />
    </div>
  );
}
