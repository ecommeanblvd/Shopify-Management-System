/**
 * Apply a fetched fuel-surcharge percentage to the `carrier_surcharges` row
 * that backs the relevant carrier account.
 *
 * Idempotent: upserts the single `fuel_percent` row for the account. If the
 * row exists, its value is updated and `last_auto_fetched_at` / `last_auto_source`
 * are stamped; if not, a new row is inserted.
 *
 * No assumption is made about *which* operator triggered the refresh — the
 * cron path passes a `system` user ID; the manual-button path passes the
 * signed-in user. Either way the audit columns get filled.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  fetchFedExFuelPercent,
  type FuelFetchResult,
  type FuelFetchOptions,
} from './fedex';
import {
  fetchDhlFuelPercent,
  type DhlFuelFetchResult,
  type DhlFuelFetchOptions,
} from './dhl';

export interface ApplyFuelInput {
  carrierAccountId: string;
  /** The full fetch result from `fetchFedExFuelPercent`. */
  fetched: FuelFetchResult;
  /** Who triggered the refresh — operator user id, or a `system:*` sentinel. */
  triggeredBy: string | null;
}

export interface ApplyFuelResult {
  surchargeId: string;
  previousPercent: number | null;
  newPercent: number;
  changed: boolean;
}

/**
 * Upsert the single `fuel_percent` surcharge row for a carrier account.
 *
 * We treat the *first* active fuel_percent row as the canonical one. If
 * the operator has manually created multiple (rare), we update the oldest
 * one and leave the rest alone so we never silently lose configuration.
 */
export async function applyFuelFetch(input: ApplyFuelInput): Promise<ApplyFuelResult> {
  const valueStr = input.fetched.current.percent.toString();
  const sourceTag = describeSource(input.fetched.sourceUrl, input.fetched.current.weekRaw);

  // Look for the existing fuel_percent row (we may have several historically).
  const existing = await db
    .select({
      id: schema.carrierSurcharges.id,
      value: schema.carrierSurcharges.value,
    })
    .from(schema.carrierSurcharges)
    .where(
      and(
        eq(schema.carrierSurcharges.carrierAccountId, input.carrierAccountId),
        eq(schema.carrierSurcharges.kind, 'fuel_percent'),
      ),
    )
    .orderBy(schema.carrierSurcharges.createdAt)
    .limit(1);

  if (existing.length > 0) {
    const prev = Number(existing[0].value);
    const changed = !Number.isFinite(prev) || prev.toString() !== valueStr;
    await db
      .update(schema.carrierSurcharges)
      .set({
        value: valueStr,
        active: true,
        lastAutoFetchedAt: input.fetched.fetchedAt,
        lastAutoSource: sourceTag,
        updatedAt: new Date(),
        ...(input.triggeredBy ? { updatedBy: input.triggeredBy } : {}),
      })
      .where(eq(schema.carrierSurcharges.id, existing[0].id));
    return {
      surchargeId: existing[0].id,
      previousPercent: Number.isFinite(prev) ? prev : null,
      newPercent: input.fetched.current.percent,
      changed,
    };
  }

  const [inserted] = await db
    .insert(schema.carrierSurcharges)
    .values({
      carrierAccountId: input.carrierAccountId,
      kind: 'fuel_percent',
      value: valueStr,
      active: true,
      note: `Auto-fetched from FedEx (${input.fetched.current.weekRaw})`,
      lastAutoFetchedAt: input.fetched.fetchedAt,
      lastAutoSource: sourceTag,
      updatedBy: input.triggeredBy ?? null,
    })
    .returning({ id: schema.carrierSurcharges.id });

  return {
    surchargeId: inserted!.id,
    previousPercent: null,
    newPercent: input.fetched.current.percent,
    changed: true,
  };
}

/** Compose `fetchFedExFuelPercent` and `applyFuelFetch` in one call. */
export async function refreshFedExFuel(args: {
  carrierAccountId: string;
  triggeredBy: string | null;
  options?: FuelFetchOptions;
}): Promise<ApplyFuelResult & { fetched: FuelFetchResult }> {
  const fetched = await fetchFedExFuelPercent(args.options);
  const applied = await applyFuelFetch({
    carrierAccountId: args.carrierAccountId,
    fetched,
    triggeredBy: args.triggeredBy,
  });
  return { ...applied, fetched };
}

/**
 * DHL counterpart of `refreshFedExFuel`. Same upsert semantics, same
 * audit columns — the only difference is which weekly source we pull
 * from and the `last_auto_source` tag.
 */
export async function refreshDhlFuel(args: {
  carrierAccountId: string;
  triggeredBy: string | null;
  options?: DhlFuelFetchOptions;
}): Promise<ApplyFuelResult & { fetched: DhlFuelFetchResult }> {
  const fetched = await fetchDhlFuelPercent(args.options);
  const valueStr = fetched.current.percent.toString();
  const weekLabel = `CW ${fetched.current.weekNumber}, ${fetched.current.year}`;
  const sourceTag = `dhl/${weekLabel}`;

  const existing = await db
    .select({
      id: schema.carrierSurcharges.id,
      value: schema.carrierSurcharges.value,
    })
    .from(schema.carrierSurcharges)
    .where(
      and(
        eq(schema.carrierSurcharges.carrierAccountId, args.carrierAccountId),
        eq(schema.carrierSurcharges.kind, 'fuel_percent'),
      ),
    )
    .orderBy(schema.carrierSurcharges.createdAt)
    .limit(1);

  if (existing.length > 0) {
    const prev = Number(existing[0].value);
    const changed = !Number.isFinite(prev) || prev.toString() !== valueStr;
    await db
      .update(schema.carrierSurcharges)
      .set({
        value: valueStr,
        active: true,
        lastAutoFetchedAt: fetched.fetchedAt,
        lastAutoSource: sourceTag,
        updatedAt: new Date(),
        ...(args.triggeredBy ? { updatedBy: args.triggeredBy } : {}),
      })
      .where(eq(schema.carrierSurcharges.id, existing[0].id));
    return {
      surchargeId: existing[0].id,
      previousPercent: Number.isFinite(prev) ? prev : null,
      newPercent: fetched.current.percent,
      changed,
      fetched,
    };
  }

  const [inserted] = await db
    .insert(schema.carrierSurcharges)
    .values({
      carrierAccountId: args.carrierAccountId,
      kind: 'fuel_percent',
      value: valueStr,
      active: true,
      note: `Auto-fetched from DHL (${weekLabel})`,
      lastAutoFetchedAt: fetched.fetchedAt,
      lastAutoSource: sourceTag,
      updatedBy: args.triggeredBy ?? null,
    })
    .returning({ id: schema.carrierSurcharges.id });

  return {
    surchargeId: inserted!.id,
    previousPercent: null,
    newPercent: fetched.current.percent,
    changed: true,
    fetched,
  };
}

/**
 * Carrier-agnostic dispatcher. Looks up the carrier key for the given
 * account and delegates to the right per-carrier fetcher. Throws when
 * the carrier doesn't have an auto-fetcher yet — operator gets a clear
 * error in the admin button toast instead of silent no-op.
 */
export async function refreshCarrierFuel(args: {
  carrierAccountId: string;
  triggeredBy: string | null;
}): Promise<ApplyFuelResult & { carrierKey: string }> {
  const [row] = await db
    .select({ carrierKey: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.id, args.carrierAccountId));
  const key = row?.carrierKey;
  if (!key) {
    throw new Error(`refreshCarrierFuel: carrier account ${args.carrierAccountId} not found`);
  }
  if (key === 'fedex') {
    const r = await refreshFedExFuel({
      carrierAccountId: args.carrierAccountId,
      triggeredBy: args.triggeredBy,
    });
    return { ...r, carrierKey: key };
  }
  if (key === 'dhl') {
    const r = await refreshDhlFuel({
      carrierAccountId: args.carrierAccountId,
      triggeredBy: args.triggeredBy,
    });
    return { ...r, carrierKey: key };
  }
  throw new Error(`refreshCarrierFuel: no fuel auto-fetcher for carrier '${key}'`);
}

function describeSource(url: string, week: string): string {
  // Keep the audit string short and human-readable. The full URL is implied
  // by the carrier+region, so we surface the week range — that's what the
  // operator actually wants to verify.
  return `fedex/${week}`;
}
