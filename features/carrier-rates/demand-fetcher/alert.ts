/**
 * Weekly FedEx Demand-Surcharge watcher.
 *
 * Fetches the FedEx Vietnam demand page, detects periods whose `effectiveFrom`
 * is NOT already a `startsAt` of an existing FedEx `demand_per_kg` row, parses
 * them, and records an audit alert per new period. It does NOT auto-apply the
 * config — applying stays a deliberate, reviewed step (the backfill script).
 *
 * Mirrors the fuel-cron pattern: a thin function the cron route + standalone
 * Railway script both call.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { fetchDemandPdfUrls, fetchDemandPdfText } from './fetch';
import { parseDemandPdfText } from './parse';

const FEDEX_CARRIER_KEY = 'fedex';

export interface DemandAlertResult {
  checkedAt: Date;
  newPeriods: Array<{
    url: string;
    from: string;
    to: string | null;
    exportRates: Record<string, number>;
  }>;
  parseErrors: Array<{ url: string; error: string }>;
}

/**
 * Fetch demand PDFs, detect periods whose effectiveFrom is NOT already a
 * startsAt of a FedEx demand_per_kg row, parse them, record an audit alert.
 * Does NOT apply config.
 */
export async function checkFedExDemandUpdates(
  fetchImpl: typeof fetch = fetch,
): Promise<DemandAlertResult> {
  const checkedAt = new Date();
  const result: DemandAlertResult = { checkedAt, newPeriods: [], parseErrors: [] };

  // 1) Resolve the enabled FedEx carrier account (same query as the backfill).
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        eq(schema.carriers.key, FEDEX_CARRIER_KEY),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );
  if (accounts.length === 0) {
    return result; // No FedEx account — nothing to compare against.
  }
  const account = accounts[0];

  // 2) Existing demand_per_kg windows → set of startsAt epoch-ms.
  const existingRows = await db
    .select({ startsAt: schema.carrierSurcharges.startsAt })
    .from(schema.carrierSurcharges)
    .where(
      and(
        eq(schema.carrierSurcharges.carrierAccountId, account.id),
        eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
      ),
    );
  const existingStarts = new Set<number>();
  for (const r of existingRows) {
    if (r.startsAt) existingStarts.add(r.startsAt.getTime());
  }

  // 3) For each PDF: parse; on error collect & continue. A parsed period whose
  //    effectiveFrom isn't already a known startsAt is NEW.
  const urls = await fetchDemandPdfUrls(fetchImpl);
  for (const url of urls) {
    let period;
    try {
      const text = await fetchDemandPdfText(url, fetchImpl);
      period = parseDemandPdfText(text);
    } catch (err) {
      result.parseErrors.push({
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (existingStarts.has(period.effectiveFrom.getTime())) {
      continue; // Already known.
    }

    const from = period.effectiveFrom.toISOString();
    const to = period.effectiveTo ? period.effectiveTo.toISOString() : null;
    const newPeriod = { url, from, to, exportRates: period.exportRates };
    result.newPeriods.push(newPeriod);

    // 4) Record an audit alert. Does NOT apply config.
    await recordAudit({
      userId: null,
      featureKey: 'carrier-rates',
      action: 'fedex_demand_new_period',
      target: account.id,
      requestSummary: JSON.stringify(newPeriod),
      result: 'success',
    });
  }

  return result;
}
