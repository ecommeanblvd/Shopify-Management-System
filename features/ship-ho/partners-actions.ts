'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { pushBrandRateCardToMmp } from './ratecard-push';
import { SHIP_HO_TIERS } from './tier-pricing';

export async function listBrandsForShipHo() {
  return db
    .select({ slug: schema.mmpBrands.slug, displayName: schema.mmpBrands.displayName })
    .from(schema.mmpBrands)
    .orderBy(schema.mmpBrands.displayName);
}

export async function listShipHoPartners() {
  return db
    .select({
      id: schema.shipHoPartners.id,
      brandSlug: schema.shipHoPartners.brandSlug,
      displayName: schema.mmpBrands.displayName,
      markupPercent: schema.shipHoPartners.markupPercent,
      billingCycle: schema.shipHoPartners.billingCycle,
      billingCurrency: schema.shipHoPartners.billingCurrency,
      status: schema.shipHoPartners.status,
      note: schema.shipHoPartners.note,
      // Tier chiết khấu (spec 09/07)
      strategic: schema.shipHoPartners.strategic,
      tierCode: schema.shipHoPartners.tierCode,
      tierOverrideCode: schema.shipHoPartners.tierOverrideCode,
      // Volume tháng trước (giờ VN) — cơ sở auto-tier, hiện cho admin tham chiếu.
      lastMonthOrders: sql<number>`(
        SELECT COUNT(*)::int FROM ship_ho_orders o
        WHERE o.partner_brand_slug = ${schema.shipHoPartners.brandSlug}
          AND o.created_at >= (date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND o.created_at <  (date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) AT TIME ZONE 'Asia/Ho_Chi_Minh')
      )`,
    })
    .from(schema.shipHoPartners)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoPartners.brandSlug))
    .orderBy(schema.mmpBrands.displayName);
}

/** Admin chỉnh tier: strategic flag + override (null/'' = theo auto). */
export async function setPartnerTier(
  id: string,
  input: { strategic?: boolean; tierOverrideCode?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const VALID = SHIP_HO_TIERS.map((t) => t.code as string);
  if (input.tierOverrideCode != null && input.tierOverrideCode !== '' && !VALID.includes(input.tierOverrideCode)) {
    return { ok: false, error: 'Tier không hợp lệ' };
  }
  await db.update(schema.shipHoPartners).set({
    ...(input.strategic !== undefined ? { strategic: input.strategic } : {}),
    ...(input.tierOverrideCode !== undefined ? { tierOverrideCode: input.tierOverrideCode || null } : {}),
  }).where(eq(schema.shipHoPartners.id, id));

  // Đổi loại đối tác → AUTO PUSH rate card mới sang MMP để hiện cho brand ngay
  // (best-effort; MMP vẫn pull được như cũ nếu push trượt).
  const [p] = await db.select({ brandSlug: schema.shipHoPartners.brandSlug })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.id, id)).limit(1);
  if (p) {
    const push = await pushBrandRateCardToMmp(p.brandSlug);
    console.log(`[ship-ho] push ratecard ${p.brandSlug} sau đổi tier: ${push.ok ? 'OK' : 'FAIL'} — ${push.detail}`);
  }

  revalidatePath('/f/ship-ho/partners');
  return { ok: true };
}

export interface UpsertPartnerInput {
  brandSlug: string;
  markupPercent: string; // numeric string, e.g. '20'
  billingCycle: 'weekly' | 'monthly';
  billingCurrency: string;
  note?: string;
}

export async function createShipHoPartner(input: UpsertPartnerInput): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (!input.brandSlug) return { ok: false, error: 'brandSlug required' };
  try {
    await db.insert(schema.shipHoPartners).values({
      brandSlug: input.brandSlug,
      markupPercent: input.markupPercent,
      billingCycle: input.billingCycle,
      billingCurrency: input.billingCurrency || 'VND',
      note: input.note || null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/f/ship-ho/partners');
  return { ok: true };
}

export async function updateShipHoPartner(
  id: string,
  input: Partial<UpsertPartnerInput> & { status?: 'active' | 'inactive' },
): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  try {
    await db
      .update(schema.shipHoPartners)
      .set({
        ...(input.markupPercent !== undefined ? { markupPercent: input.markupPercent } : {}),
        ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle } : {}),
        ...(input.billingCurrency !== undefined ? { billingCurrency: input.billingCurrency } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(schema.shipHoPartners.id, id));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/f/ship-ho/partners');
  return { ok: true };
}
