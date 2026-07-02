'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';

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
    })
    .from(schema.shipHoPartners)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoPartners.brandSlug))
    .orderBy(schema.mmpBrands.displayName);
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
  const mk = Number(input.markupPercent);
  if (!Number.isFinite(mk) || mk < 0) return { ok: false, error: 'markup không hợp lệ' };
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
