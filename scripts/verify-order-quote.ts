/**
 * One-off: re-quote a set of orders against the carrier engine with
 * each order's `processed_at_shopify` as the effectiveDate. Confirms
 * that time-versioned surcharges (#106) + the FedEx historical
 * backfill (#107) reproduce the rate sheet from each order's ship
 * week instead of today's open row.
 */

import { and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { resolveShippingEstimate } from '@/features/shopify-orders/sync/resolve-shipping-estimate';

const TARGETS = (process.argv[2] ?? '#MBLVD28990,#MBLVD28816')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function fmtVND(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

async function main(): Promise<void> {
  const orders = await db
    .select()
    .from(schema.shopifyOrders)
    .where(and(inArray(schema.shopifyOrders.shopifyOrderNumber, TARGETS)));
  if (orders.length === 0) {
    process.stdout.write(`No orders matched ${TARGETS.join(', ')}\n`);
    return;
  }

  for (const o of orders) {
    const effectiveWeight = o.shipWeightKgOverride !== null
      ? Number(o.shipWeightKgOverride)
      : o.shipWeightKg !== null ? Number(o.shipWeightKg) : null;
    const isoDate = o.processedAtShopify.toISOString().slice(0, 10);

    process.stdout.write(`\n${'='.repeat(72)}\n`);
    process.stdout.write(`${o.shopifyOrderNumber}\n`);
    process.stdout.write(`  Processed   : ${isoDate}\n`);
    process.stdout.write(`  Country     : ${o.shipCountry}\n`);
    process.stdout.write(`  Weight      : ${effectiveWeight} kg${o.shipWeightKgOverride !== null ? ' (operator override)' : ''}\n`);
    process.stdout.write(`  Carrier (ship-line): ${o.shippingCarrierKey ?? '— (defaults to fedex)'}\n`);
    process.stdout.write(`  Customer paid (revenue): ${o.totalShipping} ${o.currency}\n`);
    process.stdout.write(`  Shipping cost override : ${o.shippingCostOverride ?? '—'}\n`);

    const est = await resolveShippingEstimate({
      shipCountry: o.shipCountry,
      shipWeightKg: effectiveWeight,
      effectiveDate: o.processedAtShopify,
      shippingCarrierKey: o.shippingCarrierKey ?? null,
    });
    if (est.source === 'unknown') {
      process.stdout.write(`\n  ENGINE: unknown (reason=${est.reason})\n`);
      continue;
    }
    const b = est.breakdown!;
    process.stdout.write(`\n  ENGINE: ${est.carrierLabel} — zone "${est.zone}", tier ≤ ${est.tierUpperKg} kg\n`);
    process.stdout.write(`    base            ${fmtVND(b.base).padStart(12)} ${est.costCurrency}\n`);
    if (b.peak)         process.stdout.write(`    peak            ${fmtVND(b.peak).padStart(12)} ${est.costCurrency}\n`);
    if (b.remote)       process.stdout.write(`    remote          ${fmtVND(b.remote).padStart(12)} ${est.costCurrency}\n`);
    if (b.residential)  process.stdout.write(`    residential     ${fmtVND(b.residential).padStart(12)} ${est.costCurrency}\n`);
    if (b.perKg)        process.stdout.write(`    per_kg          ${fmtVND(b.perKg).padStart(12)} ${est.costCurrency}\n`);
    if (b.perStep)      process.stdout.write(`    per_step (GoGreen) ${fmtVND(b.perStep).padStart(9)} ${est.costCurrency}\n`);
    if (b.demand)       process.stdout.write(`    demand          ${fmtVND(b.demand).padStart(12)} ${est.costCurrency}\n`);
    if (b.countryFixed) process.stdout.write(`    country_fixed   ${fmtVND(b.countryFixed).padStart(12)} ${est.costCurrency}\n`);
    if (b.fuel)         process.stdout.write(`    fuel            ${fmtVND(b.fuel).padStart(12)} ${est.costCurrency}\n`);
    if (b.vat)          process.stdout.write(`    vat (${b.vatPercent}%)    ${fmtVND(b.vat).padStart(12)} ${est.costCurrency}\n`);
    process.stdout.write(`    ─────────────────────────────────────────\n`);
    process.stdout.write(`    carrierCost     ${fmtVND(b.carrierCost).padStart(12)} ${est.costCurrency}  =  $${est.amount.toFixed(2)} USD\n`);
  }
  process.stdout.write('\n');
}

main()
  .catch((err) => {
    process.stderr.write(`verify-order-quote: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
