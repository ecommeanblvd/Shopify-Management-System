'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export interface StoreCostFxInput {
  storeId: string;
  /** ISO-3 code (e.g. 'VND') of the currency the operator enters COGs in.
   *  Empty string clears the field — costs will then be assumed to be in
   *  the order currency. */
  costCurrency: string;
  /** How many `costCurrency` units equal 1 unit of the order currency.
   *  For Mirer (USD orders, VND costs): 24000. Empty string clears. */
  fxRate: string;
  /** Flat per-order packaging fee in the order currency. Empty string
   *  clears the field (no packaging cost added). */
  packagingFee: string;
}

export async function updateStoreCostFx(input: StoreCostFxInput): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_stores')) {
    throw new Error('forbidden');
  }

  const trimmedCurrency = input.costCurrency.trim().toUpperCase();
  if (trimmedCurrency && !/^[A-Z]{3}$/.test(trimmedCurrency)) {
    throw new Error('cost currency must be a 3-letter ISO code');
  }
  const trimmedRate = input.fxRate.trim();
  let parsedRate: string | null = null;
  if (trimmedRate) {
    const n = Number(trimmedRate);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error('FX rate must be a positive number');
    }
    parsedRate = n.toString();
  }

  const trimmedPackaging = input.packagingFee.trim();
  let parsedPackaging: string | null = null;
  if (trimmedPackaging) {
    const n = Number(trimmedPackaging);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('Packaging fee must be 0 or a positive number');
    }
    parsedPackaging = n.toString();
  }

  await db
    .update(schema.stores)
    .set({
      costCurrency: trimmedCurrency || null,
      fxCostPerOrderCurrency: parsedRate,
      packagingFee: parsedPackaging,
      costFxUpdatedAt: new Date(),
    })
    .where(eq(schema.stores.id, input.storeId));

  revalidatePath(`/f/orders/${input.storeId}`);
}
