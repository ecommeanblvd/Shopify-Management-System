import { describe, expect, it } from 'vitest';
import {
  checkStock, rollupOrderStatus, canTransitionLine,
  type StockInfo, type LineStatus,
} from './logic';

describe('checkStock', () => {
  const stock = new Map<string, StockInfo>([
    ['A', { available: 5, warehouseInventoryId: 'w-a' }],
    ['B', { available: 1, warehouseInventoryId: 'w-b' }],
  ]);
  it('marks a line in_stock when available >= qty', () => {
    expect(checkStock({ sku: 'A', qty: 3 }, stock)).toEqual({ status: 'in_stock', warehouseInventoryId: 'w-a', allocatedQty: 3 });
  });
  it('marks out_of_stock when available < qty', () => {
    expect(checkStock({ sku: 'B', qty: 2 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
  it('marks out_of_stock when sku absent from warehouse', () => {
    expect(checkStock({ sku: 'Z', qty: 1 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
  it('marks out_of_stock when sku is null', () => {
    expect(checkStock({ sku: null, qty: 1 }, stock)).toEqual({ status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 });
  });
});

describe('rollupOrderStatus', () => {
  const roll = (statuses: LineStatus[]) => rollupOrderStatus(statuses);
  it('all shipped -> shipped', () => expect(roll(['shipped', 'shipped'])).toBe('shipped'));
  it('any out_of_stock (not all shipped) -> awaiting_brand', () => expect(roll(['in_stock', 'out_of_stock'])).toBe('awaiting_brand'));
  it('all in_stock -> ready_to_pick', () => expect(roll(['in_stock', 'in_stock'])).toBe('ready_to_pick'));
  it('some picked -> picking', () => expect(roll(['picked', 'in_stock'])).toBe('picking'));
  it('some packed (none out) -> packed', () => expect(roll(['packed', 'picked'])).toBe('packed'));
  it('still pending_check -> checking', () => expect(roll(['pending_check', 'in_stock'])).toBe('checking'));
  it('empty -> received', () => expect(roll([])).toBe('received'));
  it('out_of_stock dominates pending_check', () => expect(roll(['pending_check', 'out_of_stock'])).toBe('awaiting_brand'));
  it('brand_requested rolls up to awaiting_brand', () => expect(roll(['brand_requested', 'in_stock'])).toBe('awaiting_brand'));
  it('brand_confirmed rolls up to awaiting_brand', () => expect(roll(['brand_confirmed', 'picked'])).toBe('awaiting_brand'));
  it('brand_rejected rolls up to awaiting_brand', () => expect(roll(['brand_rejected', 'shipped'])).toBe('awaiting_brand'));
});

describe('canTransitionLine', () => {
  it('in_stock -> picked allowed', () => expect(canTransitionLine('in_stock', 'picked')).toBe(true));
  it('picked -> packed allowed', () => expect(canTransitionLine('picked', 'packed')).toBe(true));
  it('packed -> shipped allowed', () => expect(canTransitionLine('packed', 'shipped')).toBe(true));
  it('in_stock -> packed NOT allowed (must pick first)', () => expect(canTransitionLine('in_stock', 'packed')).toBe(false));
  it('out_of_stock -> picked NOT allowed', () => expect(canTransitionLine('out_of_stock', 'picked')).toBe(false));
});
