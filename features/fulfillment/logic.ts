/**
 * Pure fulfillment logic — no DB. Stock check, order-status rollup, and
 * line transition validation. Unit-testable in isolation.
 */
export type LineStatus = 'pending_check' | 'in_stock' | 'out_of_stock' | 'picked' | 'packed' | 'shipped'
  | 'brand_requested' | 'brand_confirmed' | 'brand_rejected';
export type OrderStatus = 'received' | 'checking' | 'awaiting_brand' | 'ready_to_pick' | 'picking' | 'packed' | 'shipped';

export interface StockInfo {
  available: number; // qtyOnHand - qtyReserved
  warehouseInventoryId: string;
}

export interface CheckResult {
  status: 'in_stock' | 'out_of_stock';
  warehouseInventoryId: string | null;
  allocatedQty: number;
}

/** Decide a single line's stock status against a sku->stock map. */
export function checkStock(line: { sku: string | null; qty: number }, stock: Map<string, StockInfo>): CheckResult {
  if (line.sku == null) return { status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 };
  const info = stock.get(line.sku);
  if (info && info.available >= line.qty) {
    return { status: 'in_stock', warehouseInventoryId: info.warehouseInventoryId, allocatedQty: line.qty };
  }
  return { status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 };
}

/** Derive the order-level rollup status from its line statuses. */
export function rollupOrderStatus(lines: LineStatus[]): OrderStatus {
  if (lines.length === 0) return 'received';
  if (lines.every((s) => s === 'shipped')) return 'shipped';
  if (lines.some((s) => s === 'out_of_stock' || s === 'brand_requested' || s === 'brand_confirmed' || s === 'brand_rejected')) return 'awaiting_brand';
  if (lines.some((s) => s === 'pending_check')) return 'checking';
  // No out_of_stock / pending_check left: all in {in_stock, picked, packed, shipped}
  if (lines.some((s) => s === 'packed' || s === 'shipped')) return 'packed';
  if (lines.some((s) => s === 'picked')) return 'picking';
  return 'ready_to_pick';
}

const NEXT: Record<LineStatus, LineStatus | null> = {
  pending_check: null, out_of_stock: null,
  in_stock: 'picked', picked: 'packed', packed: 'shipped', shipped: null,
  brand_requested: null, brand_confirmed: null, brand_rejected: null,
};

/** Is moving a line from -> to a valid forward step? */
export function canTransitionLine(from: LineStatus, to: LineStatus): boolean {
  return NEXT[from] === to;
}
