import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoOrders } from '@/features/ship-ho/queries';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp', quoted: 'Đã báo giá', shipped: 'Đã gửi',
  delivered: 'Đã giao', billed: 'Đã lên bảng kê', settled: 'Đã thanh toán',
};

export default async function ShipHoListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const sp = await searchParams;
  const sourceFilter = sp['source'] === 'mmp' ? 'mmp' : null;
  const allOrders = await listShipHoOrders();
  const orders = sourceFilter ? allOrders.filter((o) => o.source === 'mmp') : allOrders;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Đơn ship hộ</h1>
          <p className="text-sm text-muted-foreground">Ship hộ cho đối tác brand ngoài (tách khỏi đơn khách lẻ).</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={sourceFilter ? '/f/ship-ho' : '/f/ship-ho?source=mmp'}
            className={buttonVariants({ variant: sourceFilter ? 'default' : 'outline' })}
          >
            {sourceFilter ? 'Đang lọc: MMP' : 'Chỉ đơn MMP'}
          </Link>
          <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>Đối tác</Link>
          <Link href="/f/ship-ho/import" className={buttonVariants({ variant: 'outline' })}>Import</Link>
          <Link href="/f/ship-ho/reconcile" className={buttonVariants({ variant: 'outline' })}>Đối soát</Link>
          <Link href="/f/ship-ho/statements" className={buttonVariants({ variant: 'outline' })}>Bảng kê</Link>
          <Link href="/f/ship-ho/new" className={buttonVariants({})}>+ Tạo đơn</Link>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:text-left [&>th]:p-3">
                <th>Mã</th><th>Đối tác</th><th>Đến</th><th>Cân</th><th>Carrier</th><th>Cước gốc</th><th>Giá thu</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ.</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td>
                    <Link href={`/f/ship-ho/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.code}</Link>
                    {o.source === 'mmp' && <span className="ml-2 rounded bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5">MMP</span>}
                  </td>
                  <td>{o.brandName ?? o.partnerBrandSlug}</td>
                  <td>{o.country}</td>
                  <td>{o.weightKg} kg</td>
                  <td>{o.carrierKey ?? '—'}</td>
                  <td>{o.carrierCostVnd ? Number(o.carrierCostVnd).toLocaleString('vi-VN') : '—'}</td>
                  <td className="font-medium">{o.chargedVnd ? Number(o.chargedVnd).toLocaleString('vi-VN') : '—'}</td>
                  <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
