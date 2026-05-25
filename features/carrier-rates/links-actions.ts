'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface MarketCarrierLink {
  id: string;
  marketHandle: string;
  carrierAccountId: string;
  serviceLabel: string;
  position: number;
  enabled: boolean;
  // Joined for display
  carrierAccountName: string;
  carrierKey: string | null;
  costCurrency: string;
  displayCurrency: string;
}

/** List every link configured for a given market, ordered by position. */
export async function listLinksForMarket(marketHandle: string): Promise<MarketCarrierLink[]> {
  return db
    .select({
      id: schema.marketCarrierLinks.id,
      marketHandle: schema.marketCarrierLinks.marketHandle,
      carrierAccountId: schema.marketCarrierLinks.carrierAccountId,
      serviceLabel: schema.marketCarrierLinks.serviceLabel,
      position: schema.marketCarrierLinks.position,
      enabled: schema.marketCarrierLinks.enabled,
      carrierAccountName: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
    })
    .from(schema.marketCarrierLinks)
    .innerJoin(
      schema.carrierAccounts,
      eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId),
    )
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.marketCarrierLinks.marketHandle, marketHandle))
    .orderBy(asc(schema.marketCarrierLinks.position));
}

/** Reverse lookup — every market this carrier_account currently serves. */
export async function listMarketsForCarrier(carrierAccountId: string): Promise<MarketCarrierLink[]> {
  return db
    .select({
      id: schema.marketCarrierLinks.id,
      marketHandle: schema.marketCarrierLinks.marketHandle,
      carrierAccountId: schema.marketCarrierLinks.carrierAccountId,
      serviceLabel: schema.marketCarrierLinks.serviceLabel,
      position: schema.marketCarrierLinks.position,
      enabled: schema.marketCarrierLinks.enabled,
      carrierAccountName: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
    })
    .from(schema.marketCarrierLinks)
    .innerJoin(
      schema.carrierAccounts,
      eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId),
    )
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.marketCarrierLinks.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.marketCarrierLinks.marketHandle));
}

export interface CreateLinkInput {
  marketHandle: string;
  carrierAccountId: string;
  serviceLabel: string;
}

export async function createLink(input: CreateLinkInput, userId: string): Promise<string> {
  const label = input.serviceLabel.trim();
  if (!label) throw new Error('Service label is required.');

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.marketCarrierLinks.position}), -1) + 1` })
    .from(schema.marketCarrierLinks)
    .where(eq(schema.marketCarrierLinks.marketHandle, input.marketHandle));

  try {
    const [row] = await db
      .insert(schema.marketCarrierLinks)
      .values({
        marketHandle: input.marketHandle,
        carrierAccountId: input.carrierAccountId,
        serviceLabel: label,
        position: next,
        updatedBy: userId,
      })
      .returning({ id: schema.marketCarrierLinks.id });
    return row!.id;
  } catch (err) {
    // Friendly message for the uniqueIndex collision
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new Error('This carrier account is already linked to this market.');
    }
    throw err;
  }
}

export async function deleteLink(id: string): Promise<void> {
  await db.delete(schema.marketCarrierLinks).where(eq(schema.marketCarrierLinks.id, id));
}

export interface UpdateLinkInput {
  id: string;
  serviceLabel?: string;
  enabled?: boolean;
}

export async function updateLink(input: UpdateLinkInput, userId: string): Promise<void> {
  const patch: Partial<typeof schema.marketCarrierLinks.$inferInsert> = {
    updatedBy: userId,
    updatedAt: new Date(),
  };
  if (input.serviceLabel !== undefined) {
    const label = input.serviceLabel.trim();
    if (!label) throw new Error('Service label cannot be empty.');
    patch.serviceLabel = label;
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  await db
    .update(schema.marketCarrierLinks)
    .set(patch)
    .where(eq(schema.marketCarrierLinks.id, input.id));
}

/** Carrier accounts available to link from the market UI. */
export async function listLinkableCarrierAccounts(): Promise<{
  id: string;
  name: string;
  carrierKey: string | null;
}[]> {
  return db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true))
    .orderBy(asc(schema.carrierAccounts.name));
}
