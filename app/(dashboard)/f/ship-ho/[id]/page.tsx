import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getShipHoOrder } from '@/features/ship-ho/queries';
import { shipHoPriceStructure } from '@/features/ship-ho/price-structure';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MmpOrderActions } from './MmpOrderActions';
import { TrackingCard } from './TrackingCard';
import { SmsMeasureCard } from './SmsMeasureCard';

export const dynamic = 'force-dynamic';

const vnd = (v: string | null | undefined) => (v ? Number(v).toLocaleString('vi-VN') + ' ₫' : '—');

export default async function ShipHoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const o = await getShipHoOrder(id);
  if (!o) notFound();

  const price = (o.quoteBreakdown && o.carrierCostVnd && o.chargedVnd)
    ? shipHoPriceStructure({
        breakdown: o.quoteBreakdown,
        carrierCostVnd: Number(o.carrierCostVnd),
        chargedVnd: Number(o.chargedVnd),
        markupPercent: Number(o.markupPercent ?? 0),
        serviceLabel: o.service === 'standard' ? 'Standard Delivery' : 'Express Delivery',
        actualBill: (o.actualBillBreakdown && o.actualCarrierCostVnd)
          ? {
              breakdown: o.actualBillBreakdown,
              totalVnd: Number(o.actualCarrierCostVnd),
              weightKg: o.actualWeightKg == null ? null : Number(o.actualWeightKg),
            }
          : null,
      })
    : null;
  const marginVnd = price ? price.chargeTotal - price.costTotal : null;
  const hasBill = price?.billTotal != null;
  const canManage = hasPermission(role, 'manage_ship_ho');

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">{o.code}</h1>
        <div className="flex items-center gap-3">
          {o.source === 'mmp' && <MmpOrderActions orderId={o.id} />}
          <Link href="/f/ship-ho" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
        </div>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground">Đối tác</span><div>{o.partnerBrandSlug}</div></div>
        <div><span className="text-muted-foreground">Trạng thái</span><div>{o.status}</div></div>
        <div><span className="text-muted-foreground">Người nhận</span><div>{o.recipientName ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Liên hệ</span><div>{[o.recipientEmail, o.recipientPhone].filter(Boolean).join(' · ') || '—'}</div></div>
        <div><span className="text-muted-foreground">Đến</span><div>{[o.address1, o.city, o.province, o.postcode, o.country].filter(Boolean).join(', ')}</div></div>
        {o.houseNumber && <div><span className="text-muted-foreground">House Number</span><div>{o.houseNumber}</div></div>}
        {o.shortAddress && <div><span className="text-muted-foreground">Short Address</span><div>{o.shortAddress}</div></div>}
        {o.mapsUrl && <div><span className="text-muted-foreground">Google Maps</span><div><a href={o.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">{o.mapsUrl}</a></div></div>}
        <div><span className="text-muted-foreground">Cân</span><div>{o.weightKg} kg</div></div>
        <div><span className="text-muted-foreground">Carrier</span><div>{o.carrierKey ?? '—'}</div></div>
      </CardContent></Card>

      <SmsMeasureCard
        orderId={o.id}
        canManage={canManage}
        declared={{
          weightKg: Number(o.weightKg),
          dimLengthCm: o.dimLengthCm == null ? null : Number(o.dimLengthCm),
          dimWidthCm: o.dimWidthCm == null ? null : Number(o.dimWidthCm),
          dimHeightCm: o.dimHeightCm == null ? null : Number(o.dimHeightCm),
        }}
        sms={o.smsWeightKg == null ? null : {
          weightKg: Number(o.smsWeightKg),
          dimLengthCm: o.smsDimLengthCm == null ? null : Number(o.smsDimLengthCm),
          dimWidthCm: o.smsDimWidthCm == null ? null : Number(o.smsDimWidthCm),
          dimHeightCm: o.smsDimHeightCm == null ? null : Number(o.smsDimHeightCm),
          measuredAt: o.smsMeasuredAt ? o.smsMeasuredAt.toISOString() : null,
        }}
      />

      <Card><CardContent className="p-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Cấu trúc giá (dự tính)</div>
          {o.markupPercent && <div className="text-xs text-muted-foreground">Markup <b>{Number(o.markupPercent)}%</b></div>}
        </div>
        {!price ? (
          <div className="space-y-2">
            <div className="flex justify-between"><span>Chi phí carrier (mình trả)</span><span>{vnd(o.carrierCostVnd)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Giá thu khách</span><span>{vnd(o.chargedVnd)}</span></div>
            {!o.quotedAt && <p className="text-amber-600 text-xs">Chưa tính được giá — kiểm tra carrier account / rate card.</p>}
            {o.quotedAt && <p className="text-muted-foreground text-xs">Đơn cũ chưa lưu breakdown chi tiết — chỉ có tổng.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:py-1.5 [&>th]:font-medium">
                  <th className="text-left">Khoản</th>
                  <th className="text-right" title="Cước carrier dự tính lúc báo giá">Chi phí Carrier (dự tính)</th>
                  {hasBill && <th className="text-right" title="Cước thực từ hoá đơn carrier">Cước từ Carrier{price.billNumber ? ` · ${price.billNumber}` : ''}</th>}
                  <th className="text-right" title="Giá dự định thu khách hàng">Giá thu khách</th>
                  <th className="text-right" title={hasBill ? 'Lệch bill = cước thực − dự tính' : 'Chênh = thu − chi'}>{hasBill ? 'Lệch bill' : 'Chênh'}</th>
                </tr>
              </thead>
              <tbody>
                {/* Cân tính phí ở từng công thức — lệch cân lộ ra ngay tại đây */}
                <tr className="border-t border-border/60 bg-muted/30 [&>td]:py-1.5 text-xs">
                  <td className="text-left text-muted-foreground">Cân tính phí (kg)</td>
                  <td className="text-right">{price.weights.quoteKg ?? '—'}</td>
                  {hasBill && (
                    <td className={`text-right ${price.weights.billKg != null && price.weights.quoteKg != null && price.weights.billKg !== price.weights.quoteKg ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}>
                      {price.weights.billKg ?? '—'}
                      {price.weights.billKg != null && price.weights.quoteKg != null && price.weights.billKg !== price.weights.quoteKg && (
                        <span className="ml-1">({price.weights.billKg > price.weights.quoteKg ? '+' : ''}{Math.round((price.weights.billKg - price.weights.quoteKg) * 1000) / 1000})</span>
                      )}
                    </td>
                  )}
                  <td className="text-right">{price.weights.quoteKg ?? '—'}</td>
                  <td className="text-right text-muted-foreground">—</td>
                </tr>
                {price.rows.map((r) => {
                  const diff = hasBill
                    ? (r.billVnd == null && r.costVnd == null ? 0 : (r.billVnd ?? 0) - (r.costVnd ?? 0))
                    : (r.chargeVnd ?? 0) - (r.costVnd ?? 0);
                  return (
                    <tr key={r.label} className="border-t border-border/60 [&>td]:py-2">
                      <td className="text-left">
                        {r.label}
                        {r.percent != null && <span className="ml-1 text-[10px] text-muted-foreground">{r.percent}%</span>}
                      </td>
                      <td className="text-right">{r.costVnd == null ? <span className="text-muted-foreground">—</span> : r.costVnd.toLocaleString('vi-VN')}</td>
                      {hasBill && <td className="text-right">{r.billVnd == null ? <span className="text-muted-foreground">—</span> : r.billVnd.toLocaleString('vi-VN')}</td>}
                      <td className="text-right">{r.chargeVnd == null ? <span className="text-muted-foreground">—</span> : r.chargeVnd.toLocaleString('vi-VN')}</td>
                      <td className={`text-right ${hasBill && diff !== 0 ? (diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-muted-foreground'}`}>
                        {diff !== 0 ? (diff > 0 ? '+' : '') + diff.toLocaleString('vi-VN') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold [&>td]:py-2">
                  <td className="text-left">Tổng</td>
                  <td className="text-right">{price.costTotal.toLocaleString('vi-VN')}</td>
                  {hasBill && <td className="text-right">{price.billTotal!.toLocaleString('vi-VN')}</td>}
                  <td className="text-right">{price.chargeTotal.toLocaleString('vi-VN')}</td>
                  {hasBill ? (
                    <td className={`text-right ${price.billTotal! - price.costTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {price.billTotal! - price.costTotal > 0 ? '+' : ''}{(price.billTotal! - price.costTotal).toLocaleString('vi-VN')}
                    </td>
                  ) : (
                    <td className="text-right text-emerald-600 dark:text-emerald-400">+{(marginVnd ?? 0).toLocaleString('vi-VN')}</td>
                  )}
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {hasBill
                ? 'Cột Lệch bill = cước thực − dự tính theo từng khoản (đỏ = carrier tính cao hơn dự tính). Margin thực xem ở phần Đối soát cước bên dưới.'
                : 'Cột Chênh ở dòng Tổng chính là margin dự tính (thu − chi). Khi có hoá đơn carrier, bảng sẽ thêm cột "Cước từ Carrier" để đối soát từng khoản.'}
              {price.factor !== 1 ? ' Chi phí gốc theo ngoại tệ đã quy về VND.' : ''}
            </p>
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Đối soát cước (từ hóa đơn carrier)</div>
        <div className="flex justify-between"><span>Cân thực (bill)</span><span>{o.actualWeightKg ? `${Number(o.actualWeightKg)} kg` : '—'}</span></div>
        <div className="flex justify-between"><span>Cước carrier thực</span><span>{vnd(o.actualCarrierCostVnd)}</span></div>
        <div className="flex justify-between"><span>Lệch engine (thực − ước tính)</span><span>{vnd(o.deltaVnd)}</span></div>
        <div className="flex justify-between"><span>Giá thu thực (re-bill cân thực)</span><span>{vnd(o.actualChargedVnd)}</span></div>
        <div className="flex justify-between font-semibold border-t pt-2"><span>Margin (thu − thực)</span><span>{vnd(o.marginVnd)}</span></div>
        {o.reconcileStatus && <p className="text-muted-foreground text-xs">Chi tiết từng khoản của bill xem cột “Cước từ Carrier” trong bảng Cấu trúc giá ở trên.</p>}
        {!o.reconcileStatus && <p className="text-muted-foreground text-xs">Chưa đối soát cước thực.</p>}
      </CardContent></Card>

      <TrackingCard
        orderId={o.id}
        trackingNumber={o.trackingNumber}
        carrierKey={o.carrierKey}
        deliveryStatus={o.deliveryStatus}
        deliveredAt={o.deliveredAt}
      />
    </div>
  );
}
