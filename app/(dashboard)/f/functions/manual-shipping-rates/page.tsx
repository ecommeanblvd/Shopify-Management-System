import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { flattenShippingMatrix } from '@/features/markets/domain/shipping-matrix-view';
import { listSystemShipping } from '@/features/markets/system-shipping';
import { mergeSystemShippingRows } from '@/features/markets/system-shipping-domain';
import { ManualRatesBrowser, type MarketZones } from '@/components/functions/ManualRatesBrowser';
import { ZoneReferenceTable } from '@/components/functions/ZoneReferenceTable';
import { buildSystemZoneView } from '@/features/carrier-rates/zone-matrix';
import { listZonesWithCountries, type ZoneWithCountries } from '@/features/carrier-rates/zones-actions';
import { classifyFeeCoverage, type FeeCoverageResult } from '@/features/carrier-rates/push/fee-coverage';
import { PushToShopify } from '@/components/functions/PushToShopify';
import { pushShippingStep } from '@/features/carrier-rates/push-step';
import { fuelBandMidpoint, fuelBandLabel } from '@/features/carrier-rates/fuel-band';

export const dynamic = 'force-dynamic';

export default async function ManualShippingRatesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_markets_history')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const canApply = hasPermission(role, 'apply_markets');

  const stores = (await db.select().from(schema.stores))
    .map((s) => ({ id: s.id, name: s.name, shopDomain: s.shopDomain }));
  const systemRows = await listSystemShipping();
  const markets: MarketZones[] = systemRows.map((r) => ({ marketHandle: r.marketHandle, zones: flattenShippingMatrix(r.shipping) }));

  // Khoản phí CÓ/KHÔNG cover của từng carrier (suy từ cấu hình surcharge active).
  // Key theo carrier brand ('fedex'/'dhl') để client khớp với tab đang chọn.
  const carrierAccts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId));
  const coverage: Record<string, FeeCoverageResult> = {};
  for (const a of carrierAccts) {
    const surs = await db
      .select({ kind: schema.carrierSurcharges.kind, active: schema.carrierSurcharges.active, applyMode: schema.carrierSurcharges.applyMode, value: schema.carrierSurcharges.value, stepKg: schema.carrierSurcharges.stepKg, startsAt: schema.carrierSurcharges.startsAt, endsAt: schema.carrierSurcharges.endsAt })
      .from(schema.carrierSurcharges)
      .where(eq(schema.carrierSurcharges.carrierAccountId, a.id));
    if (a.key) coverage[a.key] = classifyFeeCoverage(surs.map((s) => ({ kind: s.kind, active: s.active, applyMode: s.applyMode as 'always' | 'when_billed', value: Number(s.value), stepKg: s.stepKg != null ? Number(s.stepKg) : null, startsAt: s.startsAt, endsAt: s.endsAt })) as never, a.name);
  }

  // Cảnh báo "fuel nhảy khung": engine dùng fuel LIVE nhưng giá manual ghim theo
  // MỐC-GIỮA khung 5% (ổn định trong khung). Khi fuel live đã sang khung khác so
  // với khung lúc sinh giá manual → cần sinh lại + push. Chỉ xét fedex/dhl.
  const now = new Date();
  const fuelWarnings: { carrier: string; live: number; liveLabel: string; liveMid: number; storedMid: number }[] = [];
  for (const a of carrierAccts) {
    if (a.key !== 'fedex' && a.key !== 'dhl') continue;
    const [liveRow] = await db
      .select({ value: schema.carrierSurcharges.value })
      .from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, a.id),
        eq(schema.carrierSurcharges.kind, 'fuel_percent'),
        eq(schema.carrierSurcharges.active, true),
        lte(schema.carrierSurcharges.startsAt, now),
        or(isNull(schema.carrierSurcharges.endsAt), gt(schema.carrierSurcharges.endsAt, now)),
      ))
      .orderBy(desc(schema.carrierSurcharges.startsAt))
      .limit(1);
    if (!liveRow) continue;
    const liveFuel = Number(liveRow.value);
    const liveMid = fuelBandMidpoint(liveFuel);
    const liveLabel = fuelBandLabel(liveFuel);
    const [stateRow] = await db
      .select({ fuelBandMid: schema.manualPricingState.fuelBandMid })
      .from(schema.manualPricingState)
      .where(eq(schema.manualPricingState.carrierAccountId, a.id))
      .limit(1);
    if (!stateRow) continue;
    const storedMid = Number(stateRow.fuelBandMid);
    if (storedMid !== liveMid) {
      fuelWarnings.push({ carrier: a.name, live: liveFuel, liveLabel, liveMid, storedMid });
    }
  }

  // Bảng zone HỆ THỐNG (dạng thẻ) — mỗi zone (mã vùng ME1/EU1/…) + nước trong
  // zone. Map nước→zone FedEx/DHL gốc (carrier_zones) để hiện "(FedEx Zone X /
  // DHL Zone Y)". Nguồn zone = bảng giá hệ thống (manual_shipping_config).
  const fedexAcct = carrierAccts.find((a) => a.key === 'fedex');
  const dhlAcct = carrierAccts.find((a) => a.key === 'dhl');
  const [fedexZones, dhlZones] = await Promise.all([
    fedexAcct ? listZonesWithCountries(fedexAcct.id) : Promise.resolve([]),
    dhlAcct ? listZonesWithCountries(dhlAcct.id) : Promise.resolve([]),
  ]);
  const isoToZoneLabel = (zs: ZoneWithCountries[]): Record<string, string> =>
    Object.fromEntries(zs.flatMap((z) => z.countries.map((c) => [c.toUpperCase(), z.label] as const)));
  const zoneRows = buildSystemZoneView(
    mergeSystemShippingRows(systemRows).zones,
    isoToZoneLabel(fedexZones),
    isoToZoneLabel(dhlZones),
  );

  return (
    <div className="px-6 md:px-10 py-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/f/functions" className="text-sm text-muted-foreground hover:text-foreground">← Functions</Link>
          <h1 className="text-xl font-semibold tracking-tight">Manual Shipping rates</h1>
          <span className="text-xs text-muted-foreground">Bảng giá current (flat, zone × bậc cân) với fuel đang áp — backup khi carrier API gãy.</span>
        </div>
        {canApply && stores.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <PushToShopify stores={stores.map((s) => ({ id: s.id, name: s.name }))} onPushStep={pushShippingStep} />
          </div>
        )}
      </div>

      {fuelWarnings.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="font-medium text-amber-700 dark:text-amber-400">⚠ Fuel đã nhảy khung — nên sinh lại + push giá manual</div>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {fuelWarnings.map((w) => (
              <li key={w.carrier}>• <strong>{w.carrier}</strong>: fuel hiện <strong>{w.live}%</strong> (khung {w.liveLabel}, mốc {w.liveMid}%) — giá manual đang ở mốc <strong>{w.storedMid}%</strong>.</li>
            ))}
          </ul>
        </div>
      )}

      {stores.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có store nào kết nối.</div>
      ) : (
        <>
          {markets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Store này chưa có cấu hình market/giá ship.</p>
          ) : (
            <ManualRatesBrowser markets={markets} coverage={coverage} />
          )}
        </>
      )}

      <ZoneReferenceTable rows={zoneRows} />
    </div>
  );
}
