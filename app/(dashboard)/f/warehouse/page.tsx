import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listInventory, getWarehouseSummary } from '@/features/warehouse/queries';
import { WarehouseBoard } from '@/components/fulfillment/WarehouseBoard';

export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = [7, 30, 90, 365];

export default async function WarehousePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');

  const sp = await searchParams;
  const days = ALLOWED_DAYS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  const [items, summary] = await Promise.all([listInventory(), getWarehouseSummary(from, to)]);
  const canManage = hasPermission(role, 'manage_warehouse');
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Kho MEAN</h1>
        <p className="text-sm text-muted-foreground">
          Tồn theo SKU × kho (GVM/AP/DM). Click vào SKU để xem danh sách từng món và lịch sử biến động.
        </p>
      </div>
      <WarehouseBoard items={items} canManage={canManage} summary={summary} days={days} />
    </div>
  );
}
