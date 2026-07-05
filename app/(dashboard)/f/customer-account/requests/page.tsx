import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listStoresBasic } from '@/features/customer-account/admin-queries';
import { listAdminRequests } from '@/features/customer-account/requests-admin';
import { listHubs } from '@/features/customer-account/hubs-admin';
import { REQUEST_KINDS, REQUEST_STATUSES } from '@/features/customer-account/requests-shared';
import { RequestsTable } from './RequestsTable';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ store?: string; kind?: string; status?: string }>;
}

export default async function RequestsQueuePage({ searchParams }: PageProps): Promise<React.ReactNode> {
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
  const kind = sp.kind && REQUEST_KINDS.includes(sp.kind as (typeof REQUEST_KINDS)[number]) ? sp.kind : undefined;
  const status = sp.status && REQUEST_STATUSES.includes(sp.status as (typeof REQUEST_STATUSES)[number])
    ? sp.status
    : undefined;

  const [requests, hubs] = await Promise.all([
    listAdminRequests({ storeId, kind, status }),
    listHubs(),
  ]);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <ClipboardList className="size-3.5" />
          Customer Account
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Yêu cầu đơn hàng
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Duyệt yêu cầu hủy đơn / khiếu nại (claim) khách gửi từ trang tài khoản:
          xác định lỗi, chọn kho nhận hàng trả, QC hàng, và đánh dấu hoàn tiền
          thủ công trong Shopify.
        </p>
      </header>

      <RequestsTable
        stores={stores}
        hubs={hubs}
        requests={requests}
        activeStoreId={storeId ?? ''}
        activeKind={kind ?? ''}
        activeStatus={status ?? ''}
        canManage={canManage}
      />
    </div>
  );
}
