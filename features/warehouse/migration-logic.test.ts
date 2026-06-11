import { describe, expect, it } from 'vitest';
import { computeStagingRemovals, type MigInventory, type MigLine, type MigStagedItem } from './migration-logic';

/** Helpers — dữ liệu mặc định hợp lệ, override từng test. */
function item(over: Partial<MigStagedItem> = {}): MigStagedItem {
  return {
    id: 'item-1', sku: 'SKU-A', qcResult: 'pass',
    disposition: 'allocate_to_order', fulfillmentLineId: 'line-1', ...over,
  };
}
function line(over: Partial<MigLine> = {}): MigLine {
  return { id: 'line-1', status: 'in_stock', warehouseInventoryId: 'inv-1', allocatedQty: 1, ...over };
}
function inv(over: Partial<MigInventory> = {}): MigInventory {
  return { id: 'inv-1', sku: 'SKU-A', warehouseCode: 'HN', qtyOnHand: 5, qtyReserved: 3, ...over };
}

describe('computeStagingRemovals — quy tắc gỡ staging cũ (spec §2.3)', () => {
  it('kiện pass + dòng in_stock còn trỏ kho -> gỡ −1/−1, refId = id kiện', () => {
    const plan = computeStagingRemovals([item()], [line()], [inv()], new Set());
    expect(plan.removals).toEqual([{
      lineId: 'line-1', inventoryId: 'inv-1', sku: 'SKU-A', warehouseCode: 'HN',
      deltaOnHand: -1, deltaReserved: -1, itemIds: ['item-1'], refId: 'item-1',
    }]);
    expect(plan.skipped).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('hai kiện cùng dòng -> gỡ −2/−2 một movement, refId null (nhiều kiện)', () => {
    const plan = computeStagingRemovals(
      [item({ id: 'i1' }), item({ id: 'i2' })], [line({ allocatedQty: 2 })], [inv()], new Set());
    expect(plan.removals).toHaveLength(1);
    expect(plan.removals[0]).toMatchObject({
      deltaOnHand: -2, deltaReserved: -2, itemIds: ['i1', 'i2'], refId: null,
    });
  });

  it('gỡ theo SỐ KIỆN đã pass, không theo allocatedQty (QC dở dang: 1/3 kiện về)', () => {
    // Code cũ set allocatedQty = line.qty ngay từ kiện đầu — nhưng tồn chỉ
    // từng được cộng +1/+1 MỖI KIỆN pass. Gỡ allocatedQty sẽ gỡ lố.
    const plan = computeStagingRemovals([item()], [line({ allocatedQty: 3 })], [inv()], new Set());
    expect(plan.removals[0]).toMatchObject({ deltaOnHand: -1, deltaReserved: -1 });
  });

  it('bỏ qua kiện chưa pass / fail / disposition khác (không nằm trong vũ trụ)', () => {
    const plan = computeStagingRemovals([
      item({ id: 'i1', qcResult: 'pending' }),
      item({ id: 'i2', qcResult: 'fail' }),
      item({ id: 'i3', disposition: 'store' }),
    ], [line()], [inv()], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('kiện không gắn dòng đơn -> skipped (không từng set linkage)', () => {
    const plan = computeStagingRemovals([item({ fulfillmentLineId: null })], [], [], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.skipped).toEqual([{ itemId: 'item-1', lineId: null, reason: 'kiện không gắn dòng đơn' }]);
  });

  it('kiện không SKU -> skipped (code cũ chỉ cộng tồn khi có SKU)', () => {
    const plan = computeStagingRemovals([item({ sku: null })], [line()], [inv()], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ itemId: 'item-1', reason: expect.stringContaining('SKU') });
  });

  it('dòng không còn trỏ kho (warehouseInventoryId null) -> skipped: kiện QC sau e752a41 hoặc đã nhả', () => {
    const plan = computeStagingRemovals([item()], [line({ warehouseInventoryId: null })], [], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ itemId: 'item-1', lineId: 'line-1' });
  });

  it('dòng đã picked/packed/shipped -> skipped (pick đã trừ −allocatedQty/−allocatedQty)', () => {
    for (const status of ['picked', 'packed', 'shipped']) {
      const plan = computeStagingRemovals([item()], [line({ status })], [inv()], new Set());
      expect(plan.removals).toEqual([]);
      expect(plan.skipped[0].reason).toContain('pick');
    }
  });

  it('dòng có movement auto_allocate -> conflict (linkage hiện tại do allocator MỚI cấp, không phải staging cũ)', () => {
    const plan = computeStagingRemovals([item()], [line()], [inv()], new Set(['line-1']));
    expect(plan.removals).toEqual([]);
    expect(plan.conflicts).toEqual([{
      lineId: 'line-1', itemIds: ['item-1'],
      reason: expect.stringContaining('auto_allocate'),
    }]);
  });

  it('không tìm thấy dòng tồn được trỏ -> conflict', () => {
    const plan = computeStagingRemovals([item()], [line({ warehouseInventoryId: 'inv-missing' })], [inv()], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('dòng tồn');
  });

  it('SKU kiện khác SKU dòng tồn -> conflict (không đoán)', () => {
    const plan = computeStagingRemovals([item({ sku: 'SKU-B' })], [line()], [inv()], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('SKU');
  });

  it('tồn hiện tại không đủ để gỡ (onHand) -> conflict thay vì để applyMovement nổ', () => {
    const plan = computeStagingRemovals(
      [item({ id: 'i1' }), item({ id: 'i2' })], [line({ allocatedQty: 2 })],
      [inv({ qtyOnHand: 1, qtyReserved: 1 })], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('không đủ');
  });

  it('reserved hiện tại không đủ -> conflict (reserved có thể đã bị nhả tay)', () => {
    const plan = computeStagingRemovals([item()], [line()],
      [inv({ qtyOnHand: 5, qtyReserved: 0 })], new Set());
    expect(plan.removals).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('không đủ');
  });

  it('hai dòng cùng trỏ một dòng tồn: kiểm bất biến theo TỔNG cộng dồn', () => {
    const items = [item({ id: 'i1', fulfillmentLineId: 'l1' }), item({ id: 'i2', fulfillmentLineId: 'l2' })];
    const lines = [line({ id: 'l1' }), line({ id: 'l2' })];
    // Đủ cho từng dòng riêng lẻ nhưng không đủ cho cả hai -> cả hai conflict.
    const short = computeStagingRemovals(items, lines, [inv({ qtyOnHand: 1, qtyReserved: 1 })], new Set());
    expect(short.removals).toEqual([]);
    expect(short.conflicts).toHaveLength(2);
    // Đủ cho cả hai -> hai removal riêng (một movement mỗi dòng, dễ audit).
    const ok = computeStagingRemovals(items, lines, [inv({ qtyOnHand: 2, qtyReserved: 2 })], new Set());
    expect(ok.removals).toHaveLength(2);
  });

  it('kết quả sắp xếp ổn định theo sku, kho, lineId (dry-run diff được)', () => {
    const items = [
      item({ id: 'i2', sku: 'SKU-B', fulfillmentLineId: 'l2' }),
      item({ id: 'i1', sku: 'SKU-A', fulfillmentLineId: 'l1' }),
    ];
    const lines = [
      line({ id: 'l1', warehouseInventoryId: 'invA' }),
      line({ id: 'l2', warehouseInventoryId: 'invB' }),
    ];
    const invs = [
      inv({ id: 'invA', sku: 'SKU-A' }),
      inv({ id: 'invB', sku: 'SKU-B', warehouseCode: 'SG' }),
    ];
    const plan = computeStagingRemovals(items, lines, invs, new Set());
    expect(plan.removals.map((r) => r.sku)).toEqual(['SKU-A', 'SKU-B']);
  });
});
