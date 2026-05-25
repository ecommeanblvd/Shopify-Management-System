'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface CreateAccountInput {
  carrierId: string;
  name: string;
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: string; // numeric string, e.g. '26000.0000'
  notes?: string;
  weightUnit?: 'kg' | 'lb';
}

export async function listCarriers() {
  return db.select().from(schema.carriers).orderBy(schema.carriers.name);
}

export async function listAccounts() {
  return db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      weightUnit: schema.carrierAccounts.weightUnit,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fxCostPerDisplay: schema.carrierAccounts.fxCostPerDisplay,
      fxUpdatedAt: schema.carrierAccounts.fxUpdatedAt,
      enabled: schema.carrierAccounts.enabled,
      notes: schema.carrierAccounts.notes,
      createdAt: schema.carrierAccounts.createdAt,
      carrierKey: schema.carriers.key,
      carrierName: schema.carriers.name,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .orderBy(schema.carrierAccounts.createdAt);
}

export async function getAccount(id: string) {
  const [row] = await db
    .select({
      id: schema.carrierAccounts.id,
      carrierId: schema.carrierAccounts.carrierId,
      name: schema.carrierAccounts.name,
      weightUnit: schema.carrierAccounts.weightUnit,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fxCostPerDisplay: schema.carrierAccounts.fxCostPerDisplay,
      fxUpdatedAt: schema.carrierAccounts.fxUpdatedAt,
      enabled: schema.carrierAccounts.enabled,
      notes: schema.carrierAccounts.notes,
      createdAt: schema.carrierAccounts.createdAt,
      carrierKey: schema.carriers.key,
      carrierName: schema.carriers.name,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.id, id))
    .limit(1);
  return row ?? null;
}

export async function createAccount(input: CreateAccountInput, userId: string): Promise<string> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Account name is required.');
  if (!/^[A-Z]{3}$/.test(input.costCurrency)) throw new Error('Cost currency must be a 3-letter ISO code.');
  if (!/^[A-Z]{3}$/.test(input.displayCurrency)) throw new Error('Display currency must be a 3-letter ISO code.');
  const fx = Number(input.fxCostPerDisplay);
  if (!Number.isFinite(fx) || fx <= 0) throw new Error('FX rate must be a positive number.');

  const [carrier] = await db.select().from(schema.carriers).where(eq(schema.carriers.id, input.carrierId)).limit(1);
  if (!carrier) throw new Error('Unknown carrier.');

  const [row] = await db
    .insert(schema.carrierAccounts)
    .values({
      carrierId: input.carrierId,
      name: trimmedName,
      weightUnit: input.weightUnit ?? 'kg',
      costCurrency: input.costCurrency,
      displayCurrency: input.displayCurrency,
      fxCostPerDisplay: input.fxCostPerDisplay,
      notes: input.notes?.trim() || null,
      createdBy: userId,
    })
    .returning({ id: schema.carrierAccounts.id });
  return row!.id;
}

export interface UpdateAccountInput {
  id: string;
  name?: string;
  fxCostPerDisplay?: string;
  enabled?: boolean;
  notes?: string;
}

export async function updateAccount(input: UpdateAccountInput, _userId: string): Promise<void> {
  const patch: Partial<typeof schema.carrierAccounts.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const t = input.name.trim();
    if (!t) throw new Error('Name cannot be empty.');
    patch.name = t;
  }
  if (input.fxCostPerDisplay !== undefined) {
    const fx = Number(input.fxCostPerDisplay);
    if (!Number.isFinite(fx) || fx <= 0) throw new Error('FX rate must be a positive number.');
    patch.fxCostPerDisplay = input.fxCostPerDisplay;
    patch.fxUpdatedAt = new Date();
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;

  await db.update(schema.carrierAccounts).set(patch).where(eq(schema.carrierAccounts.id, input.id));
}

export async function deleteAccount(id: string): Promise<void> {
  // ON DELETE CASCADE on zones / tiers / cells / surcharges / postcodes / quote logs / links
  await db.delete(schema.carrierAccounts).where(eq(schema.carrierAccounts.id, id));
}
