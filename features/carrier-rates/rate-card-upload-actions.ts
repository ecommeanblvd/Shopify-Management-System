'use server';

import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject, getObject } from '@/lib/storage/r2';
import { extractPdfText } from './import/pdf-text';
import { resolveParser } from './import/parsers';
import { buildRateCardCells, type RateCardPreview } from './import/preview';
import { listRateCardsForAccount } from './rate-cards-actions';
import { requireManageCarrierRates } from './require-manage';
import { windowsOverlap } from './rate-cards-windows';

export interface StagedRateCard {
  pdfKey: string;
  filename: string;
  carrierKey: string | null;
  effectiveFromGuess: string | null;
  preview: RateCardPreview | null;
  note: string | null;
}

async function accountContext(carrierAccountId: string) {
  const [account] = await db
    .select({ id: schema.carrierAccounts.id, carrierKey: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.id, carrierAccountId))
    .limit(1);
  if (!account) throw new Error('Carrier account not found.');

  const zones = await db
    .select({ id: schema.carrierZones.id, label: schema.carrierZones.label })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));
  const tiers = await db
    .select({ id: schema.carrierWeightTiers.id, upperKg: schema.carrierWeightTiers.upperKg })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
    .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`));

  return { account, zones, tiers };
}

/** Upload the PDF to R2, parse it, return a review preview (no DB writes). */
export async function stageRateCardPdf(carrierAccountId: string, file: File): Promise<StagedRateCard> {
  await requireManageCarrierRates();
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Please upload a PDF file.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('PDF too large (max 10 MB).');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfKey = `rate-cards/${carrierAccountId}/${randomUUID()}.pdf`;
  await putObject(pdfKey, bytes, 'application/pdf');

  const { account, zones, tiers } = await accountContext(carrierAccountId);
  const parser = resolveParser(account.carrierKey ?? null);
  if (!parser) {
    return {
      pdfKey, filename: file.name, carrierKey: account.carrierKey ?? null,
      effectiveFromGuess: null, preview: null,
      note: 'No automatic parser for this carrier — the card will be created with the PDF as evidence; import rates via the CSV form.',
    };
  }

  const text = await extractPdfText(bytes);
  const built = buildRateCardCells(parser, text, tiers.map((t) => Number(t.upperKg)), zones.map((z) => z.label));
  return {
    pdfKey, filename: file.name, carrierKey: account.carrierKey ?? null,
    effectiveFromGuess: built.preview.effectiveFromGuess,
    preview: built.preview,
    note: built.problems.length ? built.problems.join(' · ') : null,
  };
}

/** Re-parse from the stored PDF (never trust client cells) and write the card + cells. */
export async function commitRateCardFromPdf(input: {
  carrierAccountId: string;
  pdfKey: string;
  filename: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}): Promise<{ id: string }> {
  const userId = await requireManageCarrierRates();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error('effectiveFrom must be YYYY-MM-DD.');
  if (input.effectiveTo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) throw new Error('effectiveTo must be YYYY-MM-DD or empty.');
  if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) throw new Error('effectiveTo must be on/after effectiveFrom.');

  const existing = await listRateCardsForAccount(input.carrierAccountId);
  if (windowsOverlap(existing, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })) {
    throw new Error('Window overlaps an existing rate card for this account.');
  }

  const { account, zones, tiers } = await accountContext(input.carrierAccountId);
  const parser = resolveParser(account.carrierKey ?? null);

  const cardValues = {
    carrierAccountId: input.carrierAccountId,
    label: `${parser?.label ?? 'Rate card'} ${input.effectiveFrom}`,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdBy: userId,
    sourcePdfKey: input.pdfKey,
    sourcePdfFilename: input.filename,
    sourcePdfUploadedAt: new Date(),
  };

  // Evidence-only carrier (no parser): just record the card + PDF, no cells.
  if (!parser) {
    const [card] = await db.insert(schema.carrierRateCards).values(cardValues).returning({ id: schema.carrierRateCards.id });
    return { id: card.id };
  }

  // Parse + self-check BEFORE opening a transaction (slow R2/pdftotext I/O),
  // so a bad sheet never creates a card.
  const bytes = await getObject(input.pdfKey);
  const text = await extractPdfText(bytes);
  const built = buildRateCardCells(parser, text, tiers.map((t) => Number(t.upperKg)), zones.map((z) => z.label));
  if (built.problems.length) {
    throw new Error('Parse self-check failed: ' + built.problems.join(' · '));
  }

  const zoneIdByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tierIdByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));

  // Card + all cells in one transaction — no partial/empty card on failure.
  return db.transaction(async (tx) => {
    const [card] = await tx.insert(schema.carrierRateCards).values(cardValues).returning({ id: schema.carrierRateCards.id });
    await tx.insert(schema.carrierRateCells).values(built.cells.map((c) => ({
      rateCardId: card.id,
      carrierZoneId: zoneIdByLabel.get(c.zoneLabel)!,
      carrierWeightTierId: tierIdByUpper.get(c.upperKg)!,
      packageType: c.packageType,
      costAmount: c.cost.toFixed(2),
      updatedBy: userId,
    })));
    return { id: card.id };
  });
}
