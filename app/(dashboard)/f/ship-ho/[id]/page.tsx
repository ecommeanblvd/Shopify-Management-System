import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getShipHoOrder } from '@/features/ship-ho/queries';
import { shipHoPriceStructure } from '@/features/ship-ho/price-structure';
import { resolveTier } from '@/features/ship-ho/tier-pricing';
import { khopOBangGia, layOBangGia, type KetQuaKhopO } from '@/features/ship-ho/bill-base-check';
import { db, schema } from '@/db/client';
import { eq, sql } from 'drizzle-orm';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MmpOrderActions } from './MmpOrderActions';
import { TrackingCard } from './TrackingCard';
import { SmsMeasureCard } from './SmsMeasureCard';
import { CopyField } from './CopyField';
import { AddTrackingButton } from './AddTrackingButton';
import { CustomerRefEditor } from './CustomerRefEditor';
import { ShipHoCarrierPanel } from './ShipHoCarrierPanel';
import { MeasureButton } from './MeasureButton';
import { ManualStatusControl } from './ManualStatusControl';

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
  // Bậc chiết khấu + sản lượng tháng trước của đối tác — giải thích vì sao markup khác nhau giữa brand.
  const [partner] = await db.select({
    strategic: schema.shipHoPartners.strategic, tierOverrideCode: schema.shipHoPartners.tierOverrideCode, tierCode: schema.shipHoPartners.tierCode,
  }).from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, o.partnerBrandSlug)).limit(1);
  const tier = partner ? resolveTier({ strategic: partner.strategic, overrideCode: partner.tierOverrideCode, autoCode: partner.tierCode }) : null;
  const thangTruoc = await db.execute<{ n: number }>(sql.raw(
    `select count(*)::int as n from ship_ho_orders where partner_brand_slug = '${o.partnerBrandSlug.replace(/'/g, "''")}'
       and to_char(${sqlGioKinhDoanh('created_at')}, 'YYYY-MM') = to_char((now() at time zone 'UTC' at time zone 'Asia/Bangkok') - interval '1 month', 'YYYY-MM')`,
  ));
  const donThangTruoc = Number(thangTruoc.rows[0]?.n ?? 0);
  // Cước net FedEx trên bill phải trùng một ô bảng giá cố định (CEO 08/09) — kiểm sống
  // trên trang để đơn cũ (đã đóng băng) cũng được soi, không phụ thuộc cột đã lưu.
  let kiemBase: (KetQuaKhopO & { netVnd: number }) | null = null;
  if (hasBill && o.actualBillBreakdown) {
    const ab = o.actualBillBreakdown as { base?: unknown; discount?: unknown; shipDate?: unknown };
    const netVnd = Number(ab.base ?? 0) + Number(ab.discount ?? 0);
    const [acc] = await db.select({ carrierAccountId: schema.shipHoOrders.carrierAccountId }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, o.id)).limit(1);
    if (netVnd > 0 && acc?.carrierAccountId) {
      const ngay = typeof ab.shipDate === 'string' ? ab.shipDate : (o.shippedAt ?? null);
      kiemBase = { ...khopOBangGia(netVnd, await layOBangGia(acc.carrierAccountId, o.country, ngay)), netVnd };
    }
  }
  const canManage = hasPermission(role, 'manage_ship_ho');
  // Form carrier cần tên nước tiếng Anh đầy đủ ("Saudi Arabia"), không phải mã ISO.
  let countryName = o.country;
  try { countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(o.country) ?? o.country; } catch { /* mã lạ → giữ ISO */ }

  const declared = {
    weightKg: Number(o.weightKg),
    dimLengthCm: o.dimLengthCm == null ? null : Number(o.dimLengthCm),
    dimWidthCm: o.dimWidthCm == null ? null : Number(o.dimWidthCm),
    dimHeightCm: o.dimHeightCm == null ? null : Number(o.dimHeightCm),
  };
  const smsMeasured = o.smsWeightKg == null ? null : {
    weightKg: Number(o.smsWeightKg),
    dimLengthCm: o.smsDimLengthCm == null ? null : Number(o.smsDimLengthCm),
    dimWidthCm: o.smsDimWidthCm == null ? null : Number(o.smsDimWidthCm),
    dimHeightCm: o.smsDimHeightCm == null ? null : Number(o.smsDimHeightCm),
    measuredAt: o.smsMeasuredAt ? o.smsMeasuredAt.toISOString() : null,
  };

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">{o.code}</h1>
        <Link href="/f/ship-ho" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>

      {/* Thanh Thao tác kho — MỌI action của nhân viên nằm ngay đầu trang, theo
          thứ tự quy trình: đo lại → chọn line → gắn tracking → update trạng thái.
          Các card bên dưới CHỈ hiển thị thông tin. */}
      {(canManage || o.source === 'mmp') && (
        <Card><CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Thao tác kho</span>
            {canManage && <MeasureButton orderId={o.id} declared={declared} sms={smsMeasured} />}
            {canManage && <ShipHoCarrierPanel orderId={o.id} currentKey={o.carrierKey} canManage={canManage} />}
            {canManage && <AddTrackingButton orderId={o.id} trackingNumber={o.trackingNumber} carrierKey={o.carrierKey} shippedAt={o.shippedAt} />}
            {canManage && o.trackingNumber && (
              <>
                <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
                <ManualStatusControl orderId={o.id} current={o.deliveryStatus} />
              </>
            )}
            {o.source === 'mmp' && <MmpOrderActions orderId={o.id} />}
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4 space-y-4 text-sm">
        {/* Meta nội bộ (không cần copy) */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Đối tác: <b className="text-foreground">{o.partnerBrandSlug}</b></span>
          <span>Trạng thái: <b className="text-foreground">{o.status}</b></span>
          <span>Carrier: <b className="text-foreground uppercase">{o.carrierKey ?? '—'}</b></span>
          <span>Ngày đi hàng: <b className="text-foreground">{o.shippedAt
            ? new Date(`${o.shippedAt}T00:00:00`).toLocaleDateString('vi-VN')
            : '—'}</b>{canManage && o.trackingNumber ? <span className="ml-1 text-[10px]">(sửa qua “✎ Sửa tracking”)</span> : null}</span>
          <span>Mã đơn gốc (brand): {canManage
            ? <CustomerRefEditor orderId={o.id} customerRef={o.customerRef ?? null} />
            : <b className="text-foreground">{o.customerRef ?? '—'}</b>}</span>
        </div>

        {/* Các trường thông tin theo form carrier — mỗi field 1 nút copy */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chi tiết liên hệ</div>
            <CopyField label="Tên liên hệ" value={o.recipientName} />
            <CopyField label="Công ty" value={o.recipientCompany} />
            <CopyField label="Số điện thoại" value={o.recipientPhone} mono />
            <CopyField label="Email" value={o.recipientEmail} mono />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Địa chỉ</div>
            <CopyField label="Quốc gia / Vùng" value={countryName} display={`${countryName} (${o.country})`} />
            <CopyField label="Dòng địa chỉ 1" value={o.address1} />
            <CopyField label="Dòng địa chỉ 2" value={o.address2} />
            <div className="grid grid-cols-2 gap-2">
              <CopyField label="Thành phố" value={o.city} />
              <CopyField label="Bang / Tỉnh" value={o.province} />
              <CopyField label="Mã bưu chính" value={o.postcode} mono />
              {o.shortAddress ? <CopyField label="Địa chỉ ngắn (SA)" value={o.shortAddress} mono /> : <CopyField label="Số nhà" value={o.houseNumber} mono />}
            </div>
            {o.shortAddress && o.houseNumber && <CopyField label="Số nhà" value={o.houseNumber} mono />}
            {o.mapsUrl && <CopyField label="Google Maps" value={o.mapsUrl} />}
          </div>
        </div>

      </CardContent></Card>

      <SmsMeasureCard declared={declared} sms={smsMeasured} />

      <Card><CardContent className="p-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Cấu trúc giá &amp; đối soát</div>
            {o.smsMeasuredAt && o.quotedAt && o.quotedAt >= o.smsMeasuredAt && (
              <span className="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-medium text-sky-700 dark:text-sky-400"
                title="Giá đã tính lại theo số đo tại kho Inecso (cân/kích thước lệch so brand khai)">
                re-quote theo số đo Inecso · {o.smsMeasuredAt.toLocaleDateString('vi-VN')}
              </span>
            )}
            {kiemBase && (kiemBase.khop
              ? kiemBase.o && (
                <span className="rounded bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-700 dark:text-emerald-400"
                  title="Cước net FedEx trên bill trùng đúng một ô của bảng giá hợp đồng cố định (mốc cân × loại gói FedEx đã xác định)">
                  net bill = ô {kiemBase.o.loaiGoi} {kiemBase.o.kg} kg
                </span>
              )
              : (
                <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
                  title="Cước net FedEx trên bill KHÔNG trùng ô nào của bảng giá cố định — soi lại rate card hoặc dòng bill">
                  ⚠ net bill {kiemBase.netVnd.toLocaleString('vi-VN')} lệch bảng giá
                  {kiemBase.ganNhat && <> · gần nhất {kiemBase.ganNhat.loaiGoi} {kiemBase.ganNhat.kg} kg = {Math.round(kiemBase.ganNhat.vnd).toLocaleString('vi-VN')} ({kiemBase.lechVnd! > 0 ? '+' : ''}{kiemBase.lechVnd!.toLocaleString('vi-VN')})</>}
                </span>
              ))}
          </div>
          {o.markupPercent && (
            <div className="text-xs text-muted-foreground" title="Markup theo bậc sản lượng tháng trước của đối tác: Standard +20% · Silver +16% (≥50 đơn) · Gold +12% (≥100) · Platinum +8% (≥200); strategic/override do admin đặt">
              Markup <b className="text-foreground">{Number(o.markupPercent)}%</b>
              {tier && <> · {tier.name}</>} · {donThangTruoc} đơn tháng trước
            </div>
          )}
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
            {/* Hai khối tách bạch (CEO 08/09): CHI PHÍ = MEAN trả carrier (xanh lam) · THU = brand trả MEAN (xanh lục).
                Mỗi khối có Dự tính / Thực / Lệch; cột Margin = thu − chi của từng khoản. */}
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider [&>th]:py-1 [&>th]:font-semibold">
                  <th className="text-left text-muted-foreground">Khoản</th>
                  <th colSpan={hasBill ? 3 : 1} className="text-center text-sky-700 dark:text-sky-400 border-b-2 border-sky-500/40">Chi phí — MEAN trả carrier</th>
                  <th colSpan={hasBill ? 3 : 1} className="text-center text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-500/40">Thu — Brand trả MEAN</th>
                  <th className="text-center text-muted-foreground border-b-2 border-border">Margin</th>
                </tr>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:py-1.5 [&>th]:font-medium">
                  <th className="text-left"></th>
                  <th className="text-right" title="Cước carrier dự tính lúc báo giá">Dự tính</th>
                  {hasBill && <th className="text-right" title="Cước thực từ hoá đơn carrier">Bill</th>}
                  {hasBill && <th className="text-right" title="Lệch chi = bill − dự tính (đỏ = carrier tính cao hơn)">Lệch chi</th>}
                  <th className="text-right" title="Giá đã báo brand lúc tạo đơn">Dự tính</th>
                  {hasBill && <th className="text-right" title="Tính lại theo bill: cước carrier thật + cước cơ bản × markup + phí xử lý">Thực</th>}
                  {hasBill && <th className="text-right" title="Lệch thu = thực − dự tính (xanh = thu thêm)">Lệch thu</th>}
                  <th className="text-right" title={hasBill ? 'Thu thực − chi bill' : 'Thu dự tính − chi dự tính'}>{hasBill ? 'Thực' : 'Dự tính'}</th>
                </tr>
              </thead>
              <tbody>
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
                  {hasBill && <td className="text-right text-muted-foreground">—</td>}
                  <td className="text-right">{price.weights.quoteKg ?? '—'}</td>
                  {hasBill && <td className="text-right">{price.weights.billKg ?? price.weights.quoteKg ?? '—'}</td>}
                  {hasBill && <td className="text-right text-muted-foreground">—</td>}
                  <td className="text-right text-muted-foreground">—</td>
                </tr>
                {price.rows.map((r) => {
                  const cost = r.costVnd ?? 0, bill = r.billVnd ?? 0, quote = r.quoteChargeVnd ?? 0, charge = r.chargeVnd ?? 0;
                  const lechChi = hasBill && (r.billVnd != null || r.costVnd != null) ? bill - cost : null;
                  const lechThu = hasBill && (r.chargeVnd != null || r.quoteChargeVnd != null) ? charge - quote : null;
                  const margin = hasBill ? charge - bill : quote - cost;
                  const so = (v: number | null, dau = false) => v == null || v === 0 ? '—' : (dau && v > 0 ? '+' : '') + v.toLocaleString('vi-VN');
                  const mauLechChi = lechChi == null || lechChi === 0 ? 'text-muted-foreground' : lechChi > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
                  const mauLechThu = lechThu == null || lechThu === 0 ? 'text-muted-foreground' : lechThu > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
                  const mauMargin = margin === 0 ? 'text-muted-foreground' : margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
                  const laKhop = r.label === 'Điều chỉnh khớp số đã ghi';
                  return (
                    <tr key={r.label} className={`border-t border-border/60 [&>td]:py-2 ${laKhop ? 'text-muted-foreground italic' : ''}`}>
                      <td className="text-left" title={laKhop ? 'Đơn tạo trước 08/09: giá đã báo brand khác tổng các dòng tách theo công thức hiện tại — dòng này bù cho khớp. Đơn mới không còn dòng này.' : undefined}>
                        {r.label}
                        {r.percent != null && <span className="ml-1 text-[10px] text-muted-foreground">{r.percent}%</span>}
                      </td>
                      <td className="text-right text-sky-700 dark:text-sky-400">{r.costVnd == null ? <span className="text-muted-foreground">—</span> : r.costVnd.toLocaleString('vi-VN')}</td>
                      {hasBill && <td className="text-right text-sky-700 dark:text-sky-400">{r.billVnd == null ? <span className="text-muted-foreground">—</span> : r.billVnd.toLocaleString('vi-VN')}</td>}
                      {hasBill && <td className={`text-right ${mauLechChi}`}>{so(lechChi, true)}</td>}
                      <td className="text-right text-emerald-700 dark:text-emerald-400">{r.quoteChargeVnd == null ? <span className="text-muted-foreground">—</span> : r.quoteChargeVnd.toLocaleString('vi-VN')}</td>
                      {hasBill && <td className="text-right font-medium text-emerald-700 dark:text-emerald-400">{r.chargeVnd == null ? <span className="text-muted-foreground">—</span> : r.chargeVnd.toLocaleString('vi-VN')}</td>}
                      {hasBill && <td className={`text-right ${mauLechThu}`}>{so(lechThu, true)}</td>}
                      <td className={`text-right ${mauMargin}`}>{so(margin, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const lechChiTong = hasBill ? price.billTotal! - price.costTotal : null;
                  const lechThuTong = hasBill ? price.chargeTotal - price.quoteChargeTotal : null;
                  const marginTong = hasBill ? price.chargeTotal - price.billTotal! : (marginVnd ?? 0);
                  const mau = (v: number | null, tot: 'chi' | 'thu' | 'margin') => v == null || v === 0 ? 'text-muted-foreground'
                    : (tot === 'chi' ? v < 0 : v > 0) ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
                  const so = (v: number | null) => v == null ? '—' : (v > 0 ? '+' : '') + v.toLocaleString('vi-VN');
                  return (
                    <tr className="border-t-2 border-border font-semibold [&>td]:py-2">
                      <td className="text-left">Tổng</td>
                      <td className="text-right text-sky-700 dark:text-sky-400">{price.costTotal.toLocaleString('vi-VN')}</td>
                      {hasBill && (
                        <td className="text-right text-sky-700 dark:text-sky-400">
                          {price.billNumber && <span className="mr-1 text-[9px] font-normal text-muted-foreground/70">({price.billNumber})</span>}
                          {price.billTotal!.toLocaleString('vi-VN')}
                        </td>
                      )}
                      {hasBill && <td className={`text-right ${mau(lechChiTong, 'chi')}`}>{so(lechChiTong)}</td>}
                      <td className="text-right text-emerald-700 dark:text-emerald-400">{price.quoteChargeTotal.toLocaleString('vi-VN')}</td>
                      {hasBill && <td className="text-right text-emerald-700 dark:text-emerald-400">{price.chargeTotal.toLocaleString('vi-VN')}</td>}
                      {hasBill && <td className={`text-right ${mau(lechThuTong, 'thu')}`}>{so(lechThuTong)}</td>}
                      <td className={`text-right ${mau(marginTong, 'margin')}`}>{so(marginTong)}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Giá thu = cước carrier (pass-through toàn bộ) + cước cơ bản × markup + phí xử lý 50.000 (có VAT). Xăng dầu, VAT, phụ phí, ký nhận, phí NK là chi phí carrier chuyển thẳng, không markup.
              {hasBill ? ' Lệch chi: đỏ = carrier tính cao hơn dự tính. Lệch thu: xanh = thu brand thêm. Margin = thu thực − bill.' : ' Chưa có bill: Margin = thu dự tính − chi dự tính.'}
              {price.factor !== 1 ? ' Chi phí gốc theo ngoại tệ đã quy về VND.' : ''}
            </p>

            {/* Kết quả đối soát cuối — gộp cùng card, ngay dưới bảng */}
            {hasBill ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Cân thực (bill)</div>
                  <div className="font-medium tabular-nums">{o.actualWeightKg ? `${Number(o.actualWeightKg)} kg` : '—'}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Giá thu thực (re-bill cân thực)</div>
                  <div className="font-medium tabular-nums">{vnd(o.actualChargedVnd)}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Lệch bill vs dự tính</div>
                  <div className="font-medium tabular-nums">{vnd(o.deltaVnd)}</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Margin thực (thu − bill)</div>
                  <div className={`font-semibold tabular-nums ${o.marginVnd != null && Number(o.marginVnd) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{vnd(o.marginVnd)}</div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">Chưa đối soát cước thực — bấm “Đối soát từ hóa đơn carrier” ở danh sách đơn khi bill về.</p>
            )}
          </div>
        )}
      </CardContent></Card>

      <TrackingCard
        trackingNumber={o.trackingNumber}
        carrierKey={o.carrierKey}
        deliveryStatus={o.deliveryStatus}
        deliveredAt={o.deliveredAt}
      />
    </div>
  );
}
