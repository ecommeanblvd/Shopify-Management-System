import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listInventory } from '@/features/warehouse/queries';
import { WarehouseBoard } from '@/components/fulfillment/WarehouseBoard';

export const dynamic = 'force-dynamic';

export default async function WarehousePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');
  const items = await listInventory();
  const canManage = hasPermission(role, 'manage_warehouse');
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Kho MEAN</h1>
        <p className="text-sm text-muted-foreground">
          Tồn theo SKU × kho (HN/SG). Mọi biến động số lượng đi qua sổ kho — xem lịch sử bằng cách click vào dòng.
        </p>
      </div>
      <WarehouseBoard items={items} canManage={canManage} />
    </div>
  );
}
