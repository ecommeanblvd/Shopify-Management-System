'use server';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requireManageCarrierRates } from './require-manage';
import { windowsOverlap } from './rate-cards-windows';

export interface RateCardRow {
  id: string;
  label: string;
  effectiveFrom: string;       // 'YYYY-MM-DD'
  effectiveTo: string | null;
  isOpen: boolean;
  hasPdf: boolean;
  pdfFilename: string | null;
}

export async function listRateCardsForAccount(carrierAccountId: string): Promise<RateCardRow[]> {
  const rows = await db
    .select()
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierRateCards.effectiveFrom));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    isOpen: r.effectiveTo === null,
    hasPdf: r.sourcePdfKey !== null,
    pdfFilename: r.sourcePdfFilename,
  }));
}

/** The current open card (effectiveTo IS NULL). Calculator/push use this. */
export async function getCurrentCardId(carrierAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.carrierRateCards.id })
    .from(schema.carrierRateCards)
    .where(and(
      eq(schema.carrierRateCards.carrierAccountId, carrierAccountId),
      isNull(schema.carrierRateCards.effectiveTo),
    ))
    .limit(1);
  return row?.id ?? null;
}

export async function createRateCard(input: {
  carrierAccountId: string;
  label: string;
  effectiveFrom: string;       // 'YYYY-MM-DD'
  effectiveTo: string | null;
  userId: string;
}): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error('effectiveFrom must be YYYY-MM-DD.');
  if (input.effectiveTo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) throw new Error('effectiveTo must be YYYY-MM-DD or empty.');
  if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) throw new Error('effectiveTo must be on/after effectiveFrom.');
  if (!input.label.trim()) throw new Error('Label is required.');

  const existing = await listRateCardsForAccount(input.carrierAccountId);
  if (windowsOverlap(existing, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })) {
    throw new Error('Window overlaps an existing rate card for this account.');
  }

  const [row] = await db
    .insert(schema.carrierRateCards)
    .values({
      carrierAccountId: input.carrierAccountId,
      label: input.label.trim(),
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      createdBy: input.userId,
    })
    .returning({ id: schema.carrierRateCards.id });
  return { id: row.id };
}

/**
 * Update an existing card's effective window (e.g. close the open card when a
 * newer sheet is added). Validates dates and rejects windows that overlap any
 * OTHER card for the same account.
 */
export async function updateRateCard(input: {
  cardId: string;
  effectiveFrom: string;       // 'YYYY-MM-DD'
  effectiveTo: string | null;
}): Promise<void> {
  await requireManageCarrierRates();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error('effectiveFrom must be YYYY-MM-DD.');
  if (input.effectiveTo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) throw new Error('effectiveTo must be YYYY-MM-DD or empty.');
  if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) throw new Error('effectiveTo must be on/after effectiveFrom.');

  const [card] = await db
    .select({ accountId: schema.carrierRateCards.carrierAccountId })
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.id, input.cardId))
    .limit(1);
  if (!card) throw new Error('Rate card not found.');

  const siblings = (await listRateCardsForAccount(card.accountId)).filter((c) => c.id !== input.cardId);
  if (windowsOverlap(siblings, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })) {
    throw new Error('Window overlaps an existing rate card for this account.');
  }

  await db
    .update(schema.carrierRateCards)
    .set({ effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })
    .where(eq(schema.carrierRateCards.id, input.cardId));
}
