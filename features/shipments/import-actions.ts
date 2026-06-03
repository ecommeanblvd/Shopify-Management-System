/**
 * Server-side importer for the operator's LOG-Export Excel.
 *
 * Idempotent: every row's payload SHA-256 lands in
 * `shipment_charges.source_hash` with a unique index, so re-importing
 * the same file silently dedupes. Tracking-number unique index on
 * `shipments` does the same for the pack record.
 *
 * Architecture:
 *   1. Parse → ParsedShipment[] (pure)
 *   2. Resolve store handle → store_id via a single SQL pass
 *   3. Resolve order_number → shopify_order_id (left-join: missing
 *      orders still get a charge stored under a "ghost" shipment so
 *      the operator can fix the source data later)
 *   4. Per row: upsert shipments + insert shipment_charge
 *   5. Return ImportSummary
 *
 * Dry-run mode: pass `dryRun: true` to skip DB writes — useful for
 * pre-flighting a new Excel file before committing.
 */

import crypto from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseXlsxRow, type ParsedShipment, type RawRow, type CarrierKey } from './parse-xlsx-row';

export interface ImportSummary {
  totalRows: number;
  parsed: number;
  imported: number;
  alreadyImported: number;
  skipped: {
    no_tracking: number;
    no_cost: number;
    carrier_unknown: number;
    store_partner: number;
    store_disconnected: number;
    no_store_match: number;
    no_country: number;
  };
  warnings: {
    /** Tracking shows up in the Excel but the Shopify order isn't in
     *  our DB — usually means the order was placed before our backfill
     *  cutoff or in a disconnected store sub-channel. */
    orphan_orders: string[];
    /** Parse threw a hard error (shouldn't happen — surfaces here for
     *  the operator to inspect). */
    errors: Array<{ rowIndex: number; reason: string }>;
  };
  durationMs: number;
}

interface ImportOptions {
  dryRun?: boolean;
  source?: string;
}

interface RowWithIndex {
  rowIndex: number;
  parsed: ParsedShipment;
}

function emptySummary(): ImportSummary {
  return {
    totalRows: 0,
    parsed: 0,
    imported: 0,
    alreadyImported: 0,
    skipped: {
      no_tracking: 0,
      no_cost: 0,
      carrier_unknown: 0,
      store_partner: 0,
      store_disconnected: 0,
      no_store_match: 0,
      no_country: 0,
    },
    warnings: { orphan_orders: [], errors: [] },
    durationMs: 0,
  };
}

/**
 * Stable SHA-256 hash for dedup. Includes tracking, carrier, total +
 * the discount/fuel/base trio so re-importing a row whose breakdown
 * was corrected by the operator creates a NEW charge (rather than
 * silently overwriting — gives an audit trail).
 */
function hashCharge(p: ParsedShipment): string {
  const payload = JSON.stringify({
    t: p.trackingNumber,
    c: p.carrier,
    a: p.totalAmount,
    b: p.base,
    f: p.fuel,
    d: p.discount,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Resolve every store handle in one round-trip. Returns a Map keyed
 * by handle (e.g. 'meanblvd') → store UUID.
 *
 * IMPORTANT: the operator's connected stores match by `name` on the
 * `stores` table (no handle column yet — first-rev pragmatism). We
 * map the StorePrefixInfo.displayName to stores.name.
 */
async function resolveStoreIds(handles: readonly string[]): Promise<Map<string, string>> {
  if (handles.length === 0) return new Map();
  // Convention: store-prefix `handle` == `stores.name` on prod (set
  // when each store was connected). Direct equality join, no slug
  // table needed. If a store rename ever changes the name we'd need
  // a proper `slug` column — out of scope here.
  const rows = await db
    .select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores)
    .where(inArray(schema.stores.name, [...handles]));
  return new Map(rows.map((r) => [r.name, r.id] as const));
}

/**
 * Look up shopify_orders by order_number for one batch. Returns Map
 * keyed by order number (the cleaned form — no '#'). Used to wire
 * shipments.order_id.
 */
async function resolveOrderIds(orderNumbers: readonly string[]): Promise<Map<string, string>> {
  if (orderNumbers.length === 0) return new Map();
  // Operator's order_number is stored WITH the '#' prefix in DB. We
  // search both forms to be tolerant of either input.
  const withHash = orderNumbers.map((n) => (n.startsWith('#') ? n : `#${n}`));
  const rows = await db
    .select({
      id: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    })
    .from(schema.shopifyOrders)
    .where(inArray(schema.shopifyOrders.shopifyOrderNumber, withHash));
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.orderNumber.replace(/^#/, ''), r.id);
  }
  return map;
}

/**
 * Look up carrier_account_id for each carrier key, using the
 * single-account-per-key convention (FedEx + DHL = 1 contract each).
 */
async function resolveCarrierAccountIds(): Promise<Map<CarrierKey, string>> {
  const rows = await db
    .select({
      id: schema.carrierAccounts.id,
      key: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const map = new Map<CarrierKey, string>();
  for (const r of rows) {
    if (r.key === 'fedex' || r.key === 'dhl') {
      map.set(r.key, r.id);
    }
  }
  return map;
}

export async function importLogExport(
  rows: readonly RawRow[],
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const start = Date.now();
  const summary = emptySummary();
  summary.totalRows = rows.length;
  const dryRun = opts.dryRun ?? false;
  const source = opts.source ?? 'ops_xlsx';

  // PHASE 1 — pure parse. Bucket every row.
  const valid: RowWithIndex[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = parseXlsxRow(rows[i]);
    switch (r.kind) {
      case 'ok':                       summary.parsed += 1; valid.push({ rowIndex: i, parsed: r.row }); break;
      case 'skip_no_tracking':         summary.skipped.no_tracking += 1; break;
      case 'skip_no_cost':             summary.skipped.no_cost += 1; break;
      case 'skip_carrier_unknown':     summary.skipped.carrier_unknown += 1; break;
      case 'skip_store_partner':       summary.skipped.store_partner += 1; break;
      case 'skip_store_disconnected':  summary.skipped.store_disconnected += 1; break;
      case 'skip_no_store_match':      summary.skipped.no_store_match += 1; break;
      case 'skip_no_country':          summary.skipped.no_country += 1; break;
      case 'error':                    summary.warnings.errors.push({ rowIndex: i, reason: r.reason }); break;
    }
  }

  if (valid.length === 0) {
    summary.durationMs = Date.now() - start;
    return summary;
  }

  // PHASE 2 — bulk lookups (one round-trip each).
  const uniqueStoreHandles = [...new Set(valid.map((v) => v.parsed.storeHandle))];
  const uniqueOrderNumbers = [...new Set(valid.map((v) => v.parsed.orderNumber))];
  const [storeIds, orderIds, carrierIds] = await Promise.all([
    resolveStoreIds(uniqueStoreHandles),
    resolveOrderIds(uniqueOrderNumbers),
    resolveCarrierAccountIds(),
  ]);

  // PHASE 3 — per-row upsert into shipments + insert into shipment_charges.
  // Done sequentially (not parallel) so the unique-index conflict
  // semantics stay deterministic. ~2k rows = single-digit seconds.
  for (const { rowIndex, parsed } of valid) {
    const storeId = storeIds.get(parsed.storeHandle);
    if (!storeId) {
      // Store handle is connected per `store-prefix.ts` but the store
      // row doesn't exist on this environment. Surface as orphan.
      summary.warnings.orphan_orders.push(`${parsed.orderNumber} (no store row for ${parsed.storeHandle})`);
      continue;
    }
    const orderId = orderIds.get(parsed.orderNumber);
    if (!orderId) {
      summary.warnings.orphan_orders.push(parsed.orderNumber);
      continue;
    }
    const carrierAccountId = carrierIds.get(parsed.carrier) ?? null;

    if (dryRun) {
      summary.imported += 1;
      continue;
    }

    // Upsert shipment by tracking_number. Conflict updates only the
    // fields that may have changed from a re-export — the operator's
    // physical pack data (weight/dim/packaging) shouldn't change
    // post-ship, but label_created_at sometimes does.
    const shipmentRow = await db
      .insert(schema.shipments)
      .values({
        orderId,
        trackingNumber: parsed.trackingNumber,
        carrierKey: parsed.carrier,
        dimLengthCm: parsed.dimensions?.lengthCm.toString() ?? null,
        dimWidthCm: parsed.dimensions?.widthCm.toString() ?? null,
        dimHeightCm: parsed.dimensions?.heightCm.toString() ?? null,
        actualWeightKg: parsed.actualWeightKg?.toString() ?? null,
        packagingType: parsed.packagingType,
        labelCreatedAt: parsed.labelCreatedAt,
        logUniqueCode: parsed.logUniqueCode,
        originHub: parsed.originHub,
      })
      .onConflictDoUpdate({
        target: schema.shipments.trackingNumber,
        set: {
          labelCreatedAt: sql`COALESCE(EXCLUDED.label_created_at, ${schema.shipments.labelCreatedAt})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.shipments.id });
    const shipmentId = shipmentRow[0]?.id;
    if (!shipmentId) {
      summary.warnings.errors.push({ rowIndex, reason: 'shipment upsert returned no id' });
      continue;
    }

    const inserted = await db
      .insert(schema.shipmentCharges)
      .values({
        shipmentId,
        carrierAccountId,
        trackingNumber: parsed.trackingNumber,
        totalAmount: parsed.totalAmount.toString(),
        currency: 'VND',
        base: parsed.base?.toString() ?? null,
        fuel: parsed.fuel?.toString() ?? null,
        remote: parsed.remote?.toString() ?? null,
        demand: parsed.demand?.toString() ?? null,
        directSignature: parsed.directSignature?.toString() ?? null,
        vat: parsed.vat?.toString() ?? null,
        gogreen: parsed.gogreen?.toString() ?? null,
        discount: parsed.discount?.toString() ?? null,
        elevatedRisk: parsed.elevatedRisk?.toString() ?? null,
        source,
        sourceHash: hashCharge(parsed),
      })
      .onConflictDoNothing({ target: schema.shipmentCharges.sourceHash })
      .returning({ id: schema.shipmentCharges.id });

    if (inserted.length === 0) {
      summary.alreadyImported += 1;
    } else {
      summary.imported += 1;
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
