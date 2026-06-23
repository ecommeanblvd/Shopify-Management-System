import type { AddressInput } from '@/lib/fedex/address';
import { and, eq, isNull, isNotNull, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyAddress } from '@/lib/fedex/address';

export interface OrderAddressFields {
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
}

/** THUẦN: map field địa chỉ đơn → AddressInput. null khi thiếu street1/country. */
export function buildAddressInput(o: OrderAddressFields): AddressInput | null {
  if (!o.shipAddress1 || !o.shipCountry) return null;
  const streetLines = [o.shipAddress1, o.shipAddress2 ?? '']
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return {
    streetLines,
    city: o.shipCity,
    stateOrProvinceCode: o.shipProvinceCode,
    postalCode: o.shipPostcode,
    countryCode: o.shipCountry,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Verify + lưu địa chỉ 1 đơn. Lõi dùng bởi nút + batch. */
export async function verifyAndStoreOrderAddress(
  orderId: string,
): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }> {
  const [o] = await db
    .select({
      shipAddress1: schema.shopifyOrders.shipAddress1, shipAddress2: schema.shopifyOrders.shipAddress2,
      shipCity: schema.shopifyOrders.shipCity, shipProvinceCode: schema.shopifyOrders.shipProvinceCode,
      shipPostcode: schema.shopifyOrders.shipPostcode, shipCountry: schema.shopifyOrders.shipCountry,
    })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.id, orderId))
    .limit(1);
  if (!o) return { ok: false, error: 'order not found' };
  const input = buildAddressInput(o);
  if (!input) return { ok: false, error: 'no address' };
  try {
    const v = await verifyAddress(input);
    await db.update(schema.shopifyOrders).set({
      addrClass: v.classification, addrDeliverable: v.deliverable,
      addrIssue: v.issue, addrStandardized: v.standardized, addrVerifiedAt: new Date(),
    }).where(eq(schema.shopifyOrders.id, orderId));
    return { ok: true, deliverable: v.deliverable, issue: v.issue };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'verify failed' };
  }
}

/** Batch verify đơn chưa verify (cho cron + script). Rate-limit 300ms. */
export async function verifyUnverifiedAddresses(
  opts?: { limit?: number; includeVerified?: boolean },
): Promise<{ verified: number; undeliverable: number; failed: number }> {
  const limit = opts?.limit ?? 100;
  const conds = [isNotNull(schema.shopifyOrders.shipAddress1), isNotNull(schema.shopifyOrders.shipCountry)];
  if (!opts?.includeVerified) conds.push(isNull(schema.shopifyOrders.addrVerifiedAt));
  const rows = await db
    .select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .where(and(...conds))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(limit);
  let verified = 0, undeliverable = 0, failed = 0;
  for (const r of rows) {
    const res = await verifyAndStoreOrderAddress(r.id);
    if (res.ok) { verified++; if (res.deliverable === false) undeliverable++; }
    else if (res.error !== 'no address') failed++;
    await sleep(300);
  }
  return { verified, undeliverable, failed };
}
