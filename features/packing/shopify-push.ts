/** Pure helpers for pushing a pack's fulfillment to Shopify — no DB / no network. */

const CARRIER_NAMES: Record<string, string> = { fedex: 'FedEx', dhl: 'DHL' };

/** Map our carrierKey to a Shopify tracking-company display name. */
export function trackingCompany(carrierKey: string | null): string {
  if (!carrierKey) return 'Other';
  const k = carrierKey.trim().toLowerCase();
  return CARRIER_NAMES[k] ?? (k.charAt(0).toUpperCase() + k.slice(1));
}

export function hasWriteFulfillmentsScope(scopes: string[]): boolean {
  return scopes.includes('write_fulfillments');
}

export interface FoLineItem { id: string; remainingQuantity: number; lineItem: { id: string }; }
export interface FulfillmentOrderNode { id: string; lineItems: FoLineItem[]; }
export interface PackLine { shopifyLineId: string; qty: number; }
export interface FulfillmentInputGroup { fulfillmentOrderId: string; fulfillmentOrderLineItems: { id: string; quantity: number }[]; }

/** Build the `lineItemsByFulfillmentOrder` input by matching pack lines (by the
 *  underlying order LineItem gid) to fulfillable FO line items. Quantity is
 *  clamped to the FO line's remainingQuantity. Returns an error if nothing
 *  matched (e.g. already fulfilled elsewhere). */
export function buildFulfillmentLineItems(
  fulfillmentOrders: FulfillmentOrderNode[],
  packLines: PackLine[],
): { ok: true; lineItemsByFulfillmentOrder: FulfillmentInputGroup[] } | { ok: false; error: string } {
  const wantQty = new Map(packLines.map((l) => [l.shopifyLineId, l.qty]));
  const groups: FulfillmentInputGroup[] = [];
  for (const fo of fulfillmentOrders) {
    const items: { id: string; quantity: number }[] = [];
    for (const li of fo.lineItems) {
      const want = wantQty.get(li.lineItem.id);
      if (want == null) continue;
      const quantity = Math.min(want, li.remainingQuantity);
      if (quantity > 0) items.push({ id: li.id, quantity });
    }
    if (items.length > 0) groups.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: items });
  }
  if (groups.length === 0) {
    return { ok: false, error: 'Không có dòng nào khớp fulfillment order (có thể đã fulfilled)' };
  }
  return { ok: true, lineItemsByFulfillmentOrder: groups };
}
