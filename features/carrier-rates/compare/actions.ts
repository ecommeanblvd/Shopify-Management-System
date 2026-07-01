'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { loadAccountSnapshot } from '../engine/load';
import { buildComparison, type ComparisonCube, type CompareCountryMeta } from './build-comparison';
import { COMPARE_WEIGHT_GRID } from './weight-grid';
import { topShopifyCountries } from './top-countries';

export interface RateComparisonData {
  cube: ComparisonCube;
  countryMeta: CompareCountryMeta[];
  /** Ngày tính cước (để UI ghi "cước tại thời điểm …"). ISO yyyy-MM-dd. */
  asOf: string;
}

const ISO2_RE = /^[A-Z]{2}$/;
const REGION_NAMES = new Intl.DisplayNames(['vi'], { type: 'region' });

function countryName(code: string): string {
  if (!ISO2_RE.test(code)) return code;
  try { return REGION_NAMES.of(code) ?? code; } catch { return code; }
}

/**
 * Dựng bảng so sánh cước all-in (VND, gồm fuel tuần hiện tại + VAT) giữa mọi
 * carrier account `enabled`, cho top nước Shopify × lưới cân 0.5→20kg. Chỉ đọc.
 */
export async function getRateComparison(): Promise<RateComparisonData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('forbidden');

  const now = new Date();
  const [countries, accounts] = await Promise.all([
    topShopifyCountries(),
    db.select({ id: schema.carrierAccounts.id })
      .from(schema.carrierAccounts)
      .where(eq(schema.carrierAccounts.enabled, true)),
  ]);

  const snaps = (await Promise.all(accounts.map((a) => loadAccountSnapshot(a.id, now))))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const cube = buildComparison(snaps, countries.map((c) => c.code), [...COMPARE_WEIGHT_GRID], now);
  const countryMeta: CompareCountryMeta[] = countries.map((c) => ({
    code: c.code, name: countryName(c.code), orders: c.orders,
  }));

  return { cube, countryMeta, asOf: now.toISOString().slice(0, 10) };
}
