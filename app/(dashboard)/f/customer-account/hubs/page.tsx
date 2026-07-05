import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Warehouse } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listHubs } from '@/features/customer-account/hubs-admin';
import { HubsEditor } from './HubsEditor';

export const dynamic = 'force-dynamic';

export default async function HubsPage(): Promise<React.ReactNode> {
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

  const rows = await listHubs();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Warehouse className="size-3.5" />
          Customer Account
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Return hubs
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Quản lý danh sách địa chỉ kho nhận hàng đổi/trả. Các hub này sẽ được
          chọn khi duyệt yêu cầu đổi/trả của khách.
        </p>
      </header>

      <HubsEditor rows={rows} canManage={canManage} />
    </div>
  );
}
