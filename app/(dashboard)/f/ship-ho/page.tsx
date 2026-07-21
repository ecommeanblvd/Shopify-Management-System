import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listShipHoOrders } from '@/features/ship-ho/queries';
import { filterShipHoOrders } from '@/features/ship-ho/filter-orders';
import { displayCharged, displayMargin } from '@/features/ship-ho/pnl';
import { deriveShipHoStage, type ShipHoTone } from '@/features/ship-ho/order-stage';
import { shipHoPriceStructure } from '@/features/ship-ho/price-structure';
import { acceptShipHoDiscrepancy, claimShipHoWithCarrier, resolveShipHoClaim } from '@/features/ship-ho/reconcile-decision-actions';
import { ReconcileStatusCell, type ReconcileModalData } from '@/components/ship-ho/reconcile-decision-ui';
import { ReconcileBillsButton } from './ReconcileBillsButton';
import { OrderRow } from './OrderRow';
import { TrackingCell } from './TrackingCell';
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
  const canManage = hasPermission(role, 'manage_ship_ho');
  const sp = await searchParams;
  const sourceFilter = sp['source'] === 'mmp' ? 'mmp' : null;
  const q = typeof sp['q'] === 'string' ? sp['q'] : undefined;
  const allOrders = await listShipHoOrders();
  const orders = filterShipHoOrders(allOrders, { q, source: sourceFilter ?? undefined });

  // Dữ liệu ĐỐI SOÁT (quyết định + cấu trúc giá 3 phía) cho các đơn ĐÃ reconciled
  // trên trang — để cột "Đối soát" mở modal accept/claim/resolve tại chỗ. Chỉ
  // query các đơn reconciled (breakdown jsonb) → nhẹ, không đụng listShipHoOrders.
  const ids = orders.map((o) => o.id);
  const reconRows = ids.length === 0 ? [] : await db
    .select({
      id: schema.shipHoOrders.id,
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
      deltaVnd: schema.shipHoOrders.deltaVnd,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      actualWeightKg: schema.shipHoOrders.actualWeightKg,
      quoteBreakdown: schema.shipHoOrders.quoteBreakdown,
      actualBillBreakdown: schema.shipHoOrders.actualBillBreakdown,
      markupPercent: schema.shipHoOrders.markupPercent,
      service: schema.shipHoOrders.service,
    })
    .from(schema.shipHoOrders)
    .where(and(inArray(schema.shipHoOrders.id, ids), eq(schema.shipHoOrders.reconcileStatus, 'reconciled')));

  const nn = (v: string | null) => (v == null ? null : Number(v));
  const reconMap = new Map<string, Omit<ReconcileModalData, 'code' | 'hasTracking'>>();
  for (const r of reconRows) {
    const structure = (r.quoteBreakdown && r.carrierCostVnd && r.chargedVnd)
      ? shipHoPriceStructure({
          breakdown: r.quoteBreakdown,
          carrierCostVnd: Number(r.carrierCostVnd),
          chargedVnd: Number(r.chargedVnd),
          markupPercent: Number(r.markupPercent ?? 0),
          serviceLabel: r.service === 'standard' ? 'Standard Delivery' : 'Express Delivery',
          actualBill: r.actualBillBreakdown && r.actualCarrierCostVnd
            ? { breakdown: r.actualBillBreakdown, totalVnd: Number(r.actualCarrierCostVnd), weightKg: r.actualWeightKg == null ? null : Number(r.actualWeightKg) }
            : null,
        })
      : null;
    reconMap.set(r.id, {
      id: r.id,
      reconcileStatus: 'reconciled',
      reconcileDecision: r.reconcileDecision,
      estVnd: nn(r.carrierCostVnd), billVnd: nn(r.actualCarrierCostVnd), deltaVnd: nn(r.deltaVnd),
      chargedVnd: nn(r.chargedVnd), actualChargedVnd: nn(r.actualChargedVnd),
      structure,
    });
  }
  const reconcileActions = { acceptAction: acceptShipHoDiscrepancy, claimAction: claimShipHoWithCarrier, resolveAction: resolveShipHoClaim };

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
          <table className="w-full table-fixed text-xs xl:text-sm">
            {/* 10 cột, tổng 100% — vừa 1 màn hình, không scroll ngang. Chi phí dự
                tính / Giá Bill (cước thực từ hoá đơn) / Giá thu TÁCH RIÊNG để khỏi
                nhầm; Margin = Giá thu − (Giá Bill ?? Chi phí dự tính). */}
            <colgroup>
              {/* Mã: bề rộng PX CỐ ĐỊNH (table-fixed tôn trọng tuyệt đối) — mã 16 ký tự
                  + dòng reference LUÔN đủ chỗ ở mọi màn hình; các cột % chia phần còn lại. */}
              <col className="w-[140px] xl:w-[160px]" /><col className="w-[7%]" />
              <col className="w-[4%]" /><col className="w-[5%]" /><col className="w-[5%]" />
              <col className="w-[11%]" />
              <col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[9%]" />
              <col className="w-[9%]" /><col className="w-[10%]" />
            </colgroup>
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:p-2 xl:[&>th]:p-3">
                <th className="text-left">Mã</th><th className="text-left">Đối tác</th>
                <th className="text-left">Đến</th><th className="text-left">Cân</th><th className="text-left">Carrier</th>
                <th className="text-left">Tracking</th>
                <th className="text-right whitespace-nowrap" title="Cước carrier dự tính lúc báo giá">Chi phí dự tính</th>
                <th className="text-right whitespace-nowrap" title="Cước thực từ hoá đơn carrier — có số là đơn đã được bill">Giá Bill</th>
                <th className="text-right" title="Giá thu brand (quote; 'thực' = đã tính lại theo cân bill)">Giá thu</th>
                <th className="text-right" title="Giá thu − (Giá Bill nếu có, không thì Chi phí dự tính)">Margin</th>
                <th className="text-left whitespace-nowrap" title="Đối soát bill: khớp → tự động; sai lệch → cần duyệt (click)">Đối soát</th>
                <th className="text-left whitespace-nowrap">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ.</td></tr>
              ) : orders.map((o) => {
                const num = (s: string | null) => (s == null ? null : Number(s));
                const billVnd = num(o.actualCarrierCostVnd);
                const estVnd = num(o.carrierCostVnd);
                const charged = displayCharged(num(o.chargedVnd), num(o.actualChargedVnd));
                const margin = displayMargin(num(o.chargedVnd), num(o.actualChargedVnd), estVnd, billVnd);
                const actualW = o.actualWeightKg == null ? null : Number(o.actualWeightKg);
                const stage = deriveShipHoStage({
                  status: o.status, trackingNumber: o.trackingNumber, deliveryStatus: o.deliveryStatus,
                  reconcileStatus: o.reconcileStatus, marginVnd: num(o.marginVnd),
                });
                const rec = reconMap.get(o.id);
                const modalData: ReconcileModalData = {
                  id: o.id, code: o.code,
                  reconcileStatus: o.reconcileStatus,
                  reconcileDecision: rec?.reconcileDecision ?? null,
                  hasTracking: o.trackingNumber != null,
                  estVnd: rec?.estVnd ?? estVnd,
                  billVnd: rec?.billVnd ?? billVnd,
                  deltaVnd: rec?.deltaVnd ?? (billVnd != null && estVnd != null ? billVnd - estVnd : null),
                  chargedVnd: rec?.chargedVnd ?? num(o.chargedVnd),
                  actualChargedVnd: rec?.actualChargedVnd ?? num(o.actualChargedVnd),
                  structure: rec?.structure ?? null,
                };
                return (
                <OrderRow key={o.id} href={`/f/ship-ho/${o.id}`} ariaLabel={`Mở đơn ${o.code}`}
                  className="border-b hover:bg-muted/40 [&>td]:p-2 xl:[&>td]:p-3 [&>td]:align-top">
                  <td>
                    <Link href={`/f/ship-ho/${o.id}`} className="block whitespace-nowrap font-medium underline-offset-2 hover:underline">{o.code}</Link>
                    {/* Dòng 2: mã đơn gốc + label nguồn (MMP/SMS) ngay sau — không đè cột bên */}
                    <div className="truncate text-[10px] leading-tight text-muted-foreground">
                      {o.customerRef ? `${o.customerRef} ` : ''}
                      <span className={`rounded px-1 py-px font-medium ${o.source === 'mmp' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'bg-muted text-muted-foreground'}`}>{o.source === 'mmp' ? 'MMP' : 'SMS'}</span>
                    </div>
                  </td>
                  <td className="truncate">{o.brandName ?? o.partnerBrandSlug}</td>
                  <td>{o.country}</td>
                  {/* Chỉ hiện CÂN TÍNH BILL: cân bill thực (đã đối soát) → chargeable từ quote → cân khai */}
                  <td className="tabular-nums" title="Cân dùng để tính bill">
                    {(actualW ?? (o.chargeableWeightKg == null ? null : Number(o.chargeableWeightKg)) ?? Number(o.weightKg))} kg
                  </td>
                  <td>{o.carrierKey ? <span className="font-medium uppercase">{o.carrierKey}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="overflow-visible">
                    <TrackingCell orderId={o.id} trackingNumber={o.trackingNumber} carrierKey={o.carrierKey}
                      deliveryStatus={o.deliveryStatus} canManage={canManage} />
                  </td>
                  {/* Chi phí DỰ TÍNH (quote) — không trộn với bill */}
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {estVnd == null ? <span className="text-muted-foreground">—</span> : <div>{estVnd.toLocaleString('vi-VN')}</div>}
                  </td>
                  {/* Giá Bill — cước thực từ hoá đơn carrier; có số = đơn đã được bill */}
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {billVnd == null ? <span className="text-muted-foreground">—</span> : (
                      <div className="font-medium text-sky-700 dark:text-sky-400">{billVnd.toLocaleString('vi-VN')}</div>
                    )}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap align-top">
                    {charged.vnd == null ? <span className="text-muted-foreground">—</span> : charged.actual ? (
                      <>
                        {/* Giá thu THỰC = tính lại theo cân bill (không phải số bill) */}
                        <div className="font-medium">{charged.vnd.toLocaleString('vi-VN')}</div>
                        <div className="text-[10px] leading-tight text-emerald-600 dark:text-emerald-400" title="Tính lại theo cân nặng carrier bill">thực · theo cân bill</div>
                        {num(o.chargedVnd) != null && num(o.chargedVnd) !== charged.vnd && (
                          <div className="text-[10px] leading-tight text-muted-foreground line-through">{Number(o.chargedVnd).toLocaleString('vi-VN')}</div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="font-medium">{charged.vnd.toLocaleString('vi-VN')}</div>
                        <div className="text-[10px] leading-tight text-muted-foreground">dự kiến</div>
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
                  <td className="align-top">
                    <ReconcileStatusCell row={modalData} actions={reconcileActions} />
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
