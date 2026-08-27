/**
 * GET /f/shipping-reconcile/export.csv?carrier=&country=&from=&to=
 *   → text/csv: one row per shipment with billed vs engine per component.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { reconcileShipmentsWithStatus } from '@/features/shipments/reconcile-view';
import { effStatus } from '@/features/shipments/reconcile-filter';
import { presetRange, rangeFileSuffix, type ExportPreset } from '@/features/shipments/export-range';

export const dynamic = 'force-dynamic';

const HEADER = [
  'order', 'tracking', 'carrier', 'country', 'shopify_weight_kg', 'weight_kg', 'chargeable_kg', 'label_date',
  'billed_total', 'engine_total', 'delta_vnd', 'delta_pct', 'status',
  'billed_base_net', 'engine_base_net',
  'billed_fuel', 'engine_fuel', 'billed_remote', 'engine_remote',
  'billed_demand', 'engine_demand', 'billed_signature', 'engine_signature',
  'billed_gogreen', 'engine_gogreen',
  'billed_vat', 'engine_vat', 'engine_reason',
];

/** Engine signature line = residential_fixed (FedEx) + addon_fixed always (DHL). */
function engineSignature(residential: number | null, addons: number | null): number | null {
  if (residential === null && addons === null) return null;
  return (residential ?? 0) + (addons ?? 0);
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const carrierParam = url.searchParams.get('carrier');
  const carrier = carrierParam === 'fedex' || carrierParam === 'dhl' || carrierParam === 'aramex'
    ? carrierParam : undefined;
  const country = url.searchParams.get('country')?.toUpperCase() || undefined;
  // Khoảng NGÀY SHIP (label_created_at) — 'YYYY-MM-DD', bao trọn 2 đầu.
  const range = presetRange(
    (url.searchParams.get('preset') as ExportPreset) || 'custom',
    new Date(),
    { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
  );
  // `to` phải bao TRỌN ngày cuối (label lưu nửa đêm, nhưng đơn nhập tay có thể
  // kèm giờ) → đẩy tới 23:59:59.999.
  const toDate = range.to ? new Date(`${range.to}T23:59:59.999Z`) : undefined;

  const { rows } = await reconcileShipmentsWithStatus({
    carrierKey: carrier,
    fromDate: range.from ? new Date(`${range.from}T00:00:00Z`) : undefined,
    toDate,
  });

  let filtered = country ? rows.filter((r) => r.shipCountry === country) : rows;
  // Lọc theo khoảng ngày = CHỈ đơn có ngày ship trong khoảng. (Bộ lọc chung giữ
  // đơn chưa có ngày để không giấu việc cần làm trên trang; nhưng file export
  // "đơn trong tháng X" mà lẫn đơn không rõ ngày thì sai bản chất.)
  if (range.from || range.to) filtered = filtered.filter((r) => r.labelDate);
  filtered.sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));

  const out: CsvValue[][] = filtered.map((r) => [
    r.orderNumber, r.trackingNumber, r.carrierKey, r.shipCountry, r.shopifyWeightKg, r.weightKg, r.chargeableKg,
    r.labelDate ? r.labelDate.toISOString().slice(0, 10) : null,
    r.billedTotal, r.engineTotal, r.deltaVnd, r.deltaPct, effStatus(r),
    r.billedBaseNet, r.engineBaseNet,
    r.billedFuel, r.engineFuel, r.billedRemote, r.engineRemote,
    r.billedDemand, r.engineDemand, r.billedSignature, engineSignature(r.engineResidential, r.engineAddons),
    r.billedGogreen, r.enginePerStep,
    r.billedVat, r.engineVat, r.engineReason,
  ]);

  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // Tên file kèm khoảng ngày → tải nhiều kỳ không đè nhau, mở ra biết ngay kỳ nào.
      'content-disposition': `attachment; filename="shipping-reconcile-${rangeFileSuffix(range)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
