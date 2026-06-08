import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWarehouse } from '@/features/fulfillment/queries';
import { WarehouseTable } from '@/components/fulfillment/WarehouseTable';

export const dynamic = 'force-dynamic';

export default async function WarehousePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');
  const items = await listWarehouse();
  const canManage = hasPermission(role, 'manage_warehouse');
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Kho MEAN</h1>
        <p className="text-sm text-muted-foreground">Tồn kho theo SKU + vị trí kệ/tầng. Nhập tay.</p>
      </div>
      <WarehouseTable items={items} canManage={canManage} />
    </div>
  );
}
