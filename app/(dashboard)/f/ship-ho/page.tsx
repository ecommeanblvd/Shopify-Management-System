import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoOrders } from '@/features/ship-ho/queries';
import { filterShipHoOrders } from '@/features/ship-ho/filter-orders';
import { displayCarrierCost, displayMargin } from '@/features/ship-ho/pnl';
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
  const q = typeof sp['q'] === 'string' ? sp['q'] : undefined;
  const allOrders = await listShipHoOrders();
  const orders = filterShipHoOrders(allOrders, { q, source: sourceFilter ?? undefined });

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
      <form className="mb-4" action="/f/ship-ho">
        {sourceFilter && <input type="hidden" name="source" value="mmp" />}
        <input name="q" defaultValue={q ?? ''} placeholder="Tìm mã đơn / mã gốc / tracking / brand…"
          className="w-full max-w-md rounded border px-3 py-2 text-sm" />
      </form>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:text-left [&>th]:p-3">
                <th>Mã</th><th>Mã đơn gốc</th><th>Đối tác</th><th>Đến</th><th>Cân</th><th>Carrier</th>
                <th className="text-right">Cước gốc</th><th className="text-right">Giá thu (dự tính)</th><th className="text-right">Margin</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ.</td></tr>
              ) : orders.map((o) => {
                const num = (s: string | null) => (s == null ? null : Number(s));
                const cost = displayCarrierCost(num(o.carrierCostVnd), num(o.actualCarrierCostVnd));
                const margin = displayMargin(num(o.chargedVnd), num(o.carrierCostVnd), num(o.actualCarrierCostVnd));
                return (
                <tr key={o.id} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td>
                    <Link href={`/f/ship-ho/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.code}</Link>
                    {o.source === 'mmp' && <span className="ml-2 rounded bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5">MMP</span>}
                  </td>
                  <td className="text-muted-foreground">{o.customerRef ?? '—'}</td>
                  <td>{o.brandName ?? o.partnerBrandSlug}</td>
                  <td>{o.country}</td>
                  <td>
                    {o.weightKg} kg
                    {(() => {
                      const ch = o.chargeableWeightKg == null ? null : Number(o.chargeableWeightKg);
                      return ch != null && ch > Number(o.weightKg) + 1e-9 ? (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400" title="Tính cước theo cân quy đổi (dim weight) vì lớn hơn cân thực">
                          tính cước {ch} kg (quy đổi)
                        </div>
                      ) : null;
                    })()}
                  </td>
                  <td>{o.carrierKey ? <span className="font-medium uppercase">{o.carrierKey}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums">
                    {cost.vnd == null ? <span className="text-muted-foreground">—</span> : (
                      <>{cost.vnd.toLocaleString('vi-VN')}
                        {!cost.actual && <span className="ml-1 text-[10px] text-muted-foreground">dự tính</span>}
                      </>
                    )}
                  </td>
                  <td className="text-right font-medium tabular-nums">{o.chargedVnd ? Number(o.chargedVnd).toLocaleString('vi-VN') : '—'}</td>
                  <td className="text-right tabular-nums">
                    {margin.vnd == null ? <span className="text-muted-foreground">—</span> : (
                      <span className={margin.vnd >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                        {margin.vnd >= 0 ? '+' : ''}{margin.vnd.toLocaleString('vi-VN')}
                        {margin.estimated && <span className="ml-1 text-[10px] font-normal text-muted-foreground">dự tính</span>}
                      </span>
                    )}
                  </td>
                  <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
