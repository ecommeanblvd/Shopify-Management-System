import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { sql, isNotNull } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { shipHoPriceStructure } from '@/features/ship-ho/price-structure';
import { ReconcileUploader } from './ReconcileUploader';
import { ReconcileBillsButton } from '../ReconcileBillsButton';
import { acceptShipHoDiscrepancy, claimShipHoWithCarrier, resolveShipHoClaim } from '@/features/ship-ho/reconcile-decision-actions';
import { ReconciledRowsTable, type ReconciledRowData } from './ReconciledRowsTable';

export const dynamic = 'force-dynamic';

const vnd = (v: string | number | null) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('vi-VN'));

export default async function ShipHoReconcilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  // Mọi đơn có tracking: đã đối soát (khớp bill) vs chờ bill.
  const rows = await db.select({
    id: schema.shipHoOrders.id,
    code: schema.shipHoOrders.code,
    trackingNumber: schema.shipHoOrders.trackingNumber,
    carrierKey: schema.shipHoOrders.carrierKey,
    country: schema.shipHoOrders.country,
    reconcileStatus: schema.shipHoOrders.reconcileStatus,
    reconcileDecision: schema.shipHoOrders.reconcileDecision,
    weightKg: schema.shipHoOrders.weightKg,
    chargeableWeightKg: sql<string | null>`${schema.shipHoOrders.quoteBreakdown}->>'chargeableWeightKg'`,
    actualWeightKg: schema.shipHoOrders.actualWeightKg,
    carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
    actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
    deltaVnd: schema.shipHoOrders.deltaVnd,
    chargedVnd: schema.shipHoOrders.chargedVnd,
    actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
    marginVnd: schema.shipHoOrders.marginVnd,
    billNumber: sql<string | null>`${schema.shipHoOrders.actualBillBreakdown}->>'billNumber'`,
    quoteBreakdown: schema.shipHoOrders.quoteBreakdown,
    actualBillBreakdown: schema.shipHoOrders.actualBillBreakdown,
    markupPercent: schema.shipHoOrders.markupPercent,
    service: schema.shipHoOrders.service,
  }).from(schema.shipHoOrders)
    .where(isNotNull(schema.shipHoOrders.trackingNumber))
    .orderBy(schema.shipHoOrders.code);

  const waiting = rows.filter((r) => r.reconcileStatus !== 'reconciled');
  // Dòng đã đối soát: tính sẵn cấu trúc giá 3 phía (server) → client chỉ expand/hiện.
  const reconciled: ReconciledRowData[] = rows
    .filter((r) => r.reconcileStatus === 'reconciled')
    .map((r) => {
      const structure = (r.quoteBreakdown && r.carrierCostVnd && r.chargedVnd)
        ? shipHoPriceStructure({
            breakdown: r.quoteBreakdown,
            carrierCostVnd: Number(r.carrierCostVnd),
            chargedVnd: Number(r.chargedVnd),
            markupPercent: Number(r.markupPercent ?? 0),
            serviceLabel: r.service === 'standard' ? 'Standard Delivery' : 'Express Delivery',
            actualBill: r.actualBillBreakdown && r.actualCarrierCostVnd
              ? {
                  breakdown: r.actualBillBreakdown,
                  totalVnd: Number(r.actualCarrierCostVnd),
                  weightKg: r.actualWeightKg == null ? null : Number(r.actualWeightKg),
                }
              : null,
          })
        : null;
      return {
        id: r.id,
        code: r.code,
        trackingNumber: r.trackingNumber,
        billNumber: r.billNumber,
        quoteKg: r.chargeableWeightKg != null ? Number(r.chargeableWeightKg) : Number(r.weightKg),
        billKg: r.actualWeightKg == null ? null : Number(r.actualWeightKg),
        estVnd: r.carrierCostVnd == null ? null : Number(r.carrierCostVnd),
        billVnd: r.actualCarrierCostVnd == null ? null : Number(r.actualCarrierCostVnd),
        deltaVnd: r.deltaVnd == null ? null : Number(r.deltaVnd),
        chargedVnd: r.chargedVnd == null ? null : Number(r.chargedVnd),
        actualChargedVnd: r.actualChargedVnd == null ? null : Number(r.actualChargedVnd),
        marginVnd: r.marginVnd == null ? null : Number(r.marginVnd),
        reconcileDecision: r.reconcileDecision,
        structure,
      };
    });

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Đối soát cước ship hộ</h1>
          <p className="text-sm text-muted-foreground">
            Tự động khớp tracking với hoá đơn carrier đã upload (cron mỗi giờ) — kéo cân/cước thực về đơn, tính lại giá thu + margin thực.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReconcileBillsButton />
          <Link href="/f/ship-ho" className={buttonVariants({ variant: 'outline' })}>← Danh sách đơn</Link>
        </div>
      </div>

      {/* Đã đối soát */}
      <Card><CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Đã đối soát ({reconciled.length})
        </div>
        {reconciled.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có đơn nào khớp hoá đơn carrier.</p>
        ) : (
          <ReconciledRowsTable rows={reconciled} acceptAction={acceptShipHoDiscrepancy} claimAction={claimShipHoWithCarrier} resolveAction={resolveShipHoClaim} />
        )}
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Click một dòng để mở chi tiết từng khoản (cước cơ bản, phụ phí, fuel, VAT) so 3 phía: dự tính · bill · giá thu.
        </p>
      </CardContent></Card>

      {/* Chờ bill */}
      <Card><CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Chờ hoá đơn carrier ({waiting.length})
        </div>
        {waiting.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không còn đơn nào chờ bill.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Mã</th><th className="text-left">Tracking</th><th className="text-left">Carrier</th>
                  <th className="text-left">Đến</th><th className="text-right">Chi phí dự tính</th><th className="text-right">Giá thu</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                    <td className="text-left"><Link href={`/f/ship-ho/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{r.code}</Link></td>
                    <td className="text-left font-mono text-xs">{r.trackingNumber}</td>
                    <td className="text-left uppercase text-xs">{r.carrierKey ?? '—'}</td>
                    <td className="text-left">{r.country}</td>
                    <td className="text-right">{vnd(r.carrierCostVnd)}</td>
                    <td className="text-right">{vnd(r.chargedVnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Đơn có tracking nhưng chưa xuất hiện trên hoá đơn carrier nào — sẽ tự khớp khi kỳ bill sau được upload (Carrier rates → Bills).
        </p>
      </CardContent></Card>

      {/* Import thủ công — phương án phụ */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Import file thủ công (phương án phụ)</summary>
        <p className="mt-2 text-sm text-muted-foreground">
          File .xlsx/.csv theo thứ tự cột: <b>tracking · cước thực (VND)</b>. Dòng đầu header (bỏ qua).
        </p>
        <div className="mt-3"><ReconcileUploader /></div>
      </details>
    </div>
  );
}
