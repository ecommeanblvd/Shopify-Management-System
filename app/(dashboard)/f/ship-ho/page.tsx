import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listShipHoOrders } from '@/features/ship-ho/queries';
import { filterShipHoOrders } from '@/features/ship-ho/filter-orders';
import { displayCarrierCost, displayCharged, displayMargin } from '@/features/ship-ho/pnl';
import { deriveShipHoStage, type ShipHoTone } from '@/features/ship-ho/order-stage';
import { ReconcileBillsButton } from './ReconcileBillsButton';
import { OrderRow } from './OrderRow';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const TONE: Record<ShipHoTone, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  muted: 'bg-muted text-muted-foreground',
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
          <ReconcileBillsButton />
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
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[15%]" /><col className="w-[11%]" /><col className="w-[9%]" />
              <col className="w-[6%]" /><col className="w-[9%]" /><col className="w-[8%]" />
              <col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[10%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:p-3">
                <th className="text-left">Mã</th><th className="text-left">Mã đơn gốc</th><th className="text-left">Đối tác</th>
                <th className="text-left">Đến</th><th className="text-left">Cân</th><th className="text-left">Carrier</th>
                <th className="text-right whitespace-nowrap">Chi phí Carrier</th><th className="text-right">Giá thu</th><th className="text-right">Margin</th>
                <th className="text-left">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ.</td></tr>
              ) : orders.map((o) => {
                const num = (s: string | null) => (s == null ? null : Number(s));
                const cost = displayCarrierCost(num(o.carrierCostVnd), num(o.actualCarrierCostVnd));
                const charged = displayCharged(num(o.chargedVnd), num(o.actualChargedVnd));
                const margin = displayMargin(num(o.chargedVnd), num(o.actualChargedVnd), num(o.carrierCostVnd), num(o.actualCarrierCostVnd));
                const actualW = o.actualWeightKg == null ? null : Number(o.actualWeightKg);
                const stage = deriveShipHoStage({
                  status: o.status, trackingNumber: o.trackingNumber, deliveryStatus: o.deliveryStatus,
                  reconcileStatus: o.reconcileStatus, marginVnd: num(o.marginVnd),
                });
                return (
                <OrderRow key={o.id} href={`/f/ship-ho/${o.id}`} ariaLabel={`Mở đơn ${o.code}`}
                  className="border-b hover:bg-muted/40 [&>td]:p-3 [&>td]:align-top">
                  <td className="whitespace-nowrap">
                    <Link href={`/f/ship-ho/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.code}</Link>
                    {o.source === 'mmp' && <span className="ml-2 rounded bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5">MMP</span>}
                  </td>
                  <td className="text-muted-foreground">{o.customerRef ?? '—'}</td>
                  <td>{o.brandName ?? o.partnerBrandSlug}</td>
                  <td>{o.country}</td>
                  {/* Chỉ hiện CÂN TÍNH BILL: cân bill thực (đã đối soát) → chargeable từ quote → cân khai */}
                  <td className="tabular-nums" title="Cân dùng để tính bill">
                    {(actualW ?? (o.chargeableWeightKg == null ? null : Number(o.chargeableWeightKg)) ?? Number(o.weightKg))} kg
                  </td>
                  <td>{o.carrierKey ? <span className="font-medium uppercase">{o.carrierKey}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {cost.vnd == null ? <span className="text-muted-foreground">—</span> : (
                      <>
                        <div>{cost.vnd.toLocaleString('vi-VN')}</div>
                        {!cost.actual && <div className="text-[10px] leading-tight text-muted-foreground">dự tính</div>}
                      </>
                    )}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {charged.vnd == null ? <span className="text-muted-foreground">—</span> : (
                      <>
                        <div className="font-medium">{charged.vnd.toLocaleString('vi-VN')}</div>
                        <div className={`text-[10px] leading-tight ${charged.actual ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'}`}>
                          {charged.actual ? 'thực' : 'dự tính'}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {margin.vnd == null ? <span className="text-muted-foreground">—</span> : (
                      <>
                        <div className={margin.vnd >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                          {margin.vnd >= 0 ? '+' : ''}{margin.vnd.toLocaleString('vi-VN')}
                        </div>
                        {margin.estimated && <div className="text-[10px] leading-tight text-muted-foreground">dự tính</div>}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[stage.tone]}`}>
                        {stage.label}
                      </span>
                      {stage.warnings.map((wn) => (
                        <span key={wn} className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold whitespace-nowrap ${TONE.bad}`} title="Đơn có vấn đề — mở chi tiết để kiểm tra">
                          ⚠ {wn}
                        </span>
                      ))}
                    </div>
                  </td>
                </OrderRow>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
