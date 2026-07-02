/**
 * Pure planning logic for the warehouse → Shopify sync of vendor "MEAN BLVD"
 * resale products. NO I/O — takes fetched Shopify products + a warehouse
 * sellable-by-SKU map and returns a plan of writes. The orchestrator
 * (`meanblvd-sync.ts`) is responsible for all I/O.
 *
 * Rules (per product, considering only tracked variants with a non-empty SKU):
 *   - target(v) = max(0, sellableByNormSku.get(normSku(v.sku)) ?? 0)
 *   - push {inventoryItemId, quantity: target} to inventorySets ONLY when
 *     target !== v.inventoryQuantity (avoid no-op Shopify writes).
 *   - allZero = have ≥1 considered variant AND every one ends at target 0.
 *   - anyPos  = some considered variant ends at target > 0.
 *   - ACTIVE   + allZero → archive.
 *   - ARCHIVED + anyPos  → unarchive.
 *   - DRAFT: never change status (but still emit inventorySets).
 * A product with no considered (tracked+sku) variants is never archived.
 */

/**
 * Normalize a SKU for matching warehouse ↔ Shopify. The warehouse uses
 * "-PLA"/"-Sale" suffix conventions that don't exist on Shopify variants (or
 * vice versa). Applied twice to collapse stacked suffixes (e.g. "X-PLA-SALE").
 */
export function normSku(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/-(SALE|PLA)$/, '')
    .replace(/-(SALE|PLA)$/, '');
}

export interface MeanVariant {
  sku: string;
  inventoryQuantity: number;
  inventoryItemId: string;
  tracked: boolean;
}

export interface MeanProduct {
  id: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  variants: MeanVariant[];
}

export interface SyncPlan {
  /** Only where target !== current inventoryQuantity. */
  inventorySets: Array<{ inventoryItemId: string; quantity: number }>;
  /** Product ids to archive. */
  archive: string[];
  /** Product ids to un-archive (→ ACTIVE). */
  unarchive: string[];
}

/** Whether a variant participates in the plan: tracked + non-empty SKU. */
function isConsidered(v: MeanVariant): boolean {
  return v.tracked === true && v.sku.trim() !== '';
}

/** Sellable target for a considered variant, clamped ≥ 0. */
function targetFor(v: MeanVariant, sellableByNormSku: Map<string, number>): number {
  const raw = sellableByNormSku.get(normSku(v.sku)) ?? 0;
  return Math.max(0, raw);
}

export function planMeanblvdSync(
  products: MeanProduct[],
  sellableByNormSku: Map<string, number>,
): SyncPlan {
  const inventorySets: SyncPlan['inventorySets'] = [];
  const archive: string[] = [];
  const unarchive: string[] = [];

  for (const product of products) {
    const considered = product.variants.filter(isConsidered);

    for (const v of considered) {
      const target = targetFor(v, sellableByNormSku);
      if (target !== v.inventoryQuantity) {
        inventorySets.push({ inventoryItemId: v.inventoryItemId, quantity: target });
      }
    }

    // Status transitions only when there is at least one considered variant.
    if (considered.length === 0) continue;

    const allZero = considered.every((v) => targetFor(v, sellableByNormSku) === 0);
    const anyPos = considered.some((v) => targetFor(v, sellableByNormSku) > 0);

    if (product.status === 'ACTIVE' && allZero) {
      archive.push(product.id);
    } else if (product.status === 'ARCHIVED' && anyPos) {
      unarchive.push(product.id);
    }
    // DRAFT: leave status alone.
  }

  return { inventorySets, archive, unarchive };
}
