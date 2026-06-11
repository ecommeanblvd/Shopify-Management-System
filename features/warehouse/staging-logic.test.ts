import { describe, expect, it } from 'vitest';
import {
  lineSource, lineCovered, groupStaging,
  type OrderLineRow, type StagedItemRow,
} from './staging-logic';

const lineInput = (over: Partial<Parameters<typeof lineSource>[0]> = {}) => ({
  status: 'in_stock', qty: 1, stagedCount: 0,
  warehouseInventoryId: null as string | null, warehouseCode: null as string | null,
  ...over,
});

describe('lineSource — chip nguồn theo dòng', () => {
  it('shipped -> Đã đi', () => {
    expect(lineSource(lineInput({ status: 'shipped' }))).toEqual({ kind: 'shipped' });
  });
  it('picked / packed -> Đã pick/đóng', () => {
    expect(lineSource(lineInput({ status: 'picked' }))).toEqual({ kind: 'progress' });
    expect(lineSource(lineInput({ status: 'packed' }))).toEqual({ kind: 'progress' });
  });
  it('đủ kiện staging -> Khu chờ (kể cả khi qty > 1)', () => {
    expect(lineSource(lineInput({ qty: 2, stagedCount: 2 }))).toEqual({ kind: 'staging' });
    expect(lineSource(lineInput({ qty: 2, stagedCount: 3 }))).toEqual({ kind: 'staging' });
  });
  it('in_stock gắn kho -> Kho <code>', () => {
    expect(lineSource(lineInput({ warehouseInventoryId: 'w1', warehouseCode: 'SG' })))
      .toEqual({ kind: 'warehouse', code: 'SG' });
  });
  it('out_of_stock / brand_* -> Chờ brand', () => {
    expect(lineSource(lineInput({ status: 'out_of_stock' }))).toEqual({ kind: 'brand' });
    expect(lineSource(lineInput({ status: 'brand_requested' }))).toEqual({ kind: 'brand' });
    expect(lineSource(lineInput({ status: 'brand_confirmed' }))).toEqual({ kind: 'brand' });
    expect(lineSource(lineInput({ status: 'brand_rejected' }))).toEqual({ kind: 'brand' });
  });
  it('pending_check -> Chờ kiểm', () => {
    expect(lineSource(lineInput({ status: 'pending_check' }))).toEqual({ kind: 'pending' });
  });
  it('in_stock không kho, staging thiếu -> none (—)', () => {
    expect(lineSource(lineInput({ qty: 2, stagedCount: 1 }))).toEqual({ kind: 'none' });
  });
  it('picked thắng staging (kiện đã pick không còn là "Khu chờ")', () => {
    expect(lineSource(lineInput({ status: 'picked', qty: 1, stagedCount: 1 })))
      .toEqual({ kind: 'progress' });
  });
  it('staging đủ thắng nhãn kho khi dòng vừa có cả hai', () => {
    expect(lineSource(lineInput({ qty: 1, stagedCount: 1, warehouseInventoryId: 'w1', warehouseCode: 'HN' })))
      .toEqual({ kind: 'staging' });
  });
});

describe('lineCovered — dòng được "che" đủ', () => {
  it('staging đủ -> covered', () => {
    expect(lineCovered(lineInput({ qty: 2, stagedCount: 2 }))).toBe(true);
  });
  it('staging thiếu -> not covered', () => {
    expect(lineCovered(lineInput({ qty: 2, stagedCount: 1 }))).toBe(false);
  });
  it('in_stock + warehouseInventoryId -> covered', () => {
    expect(lineCovered(lineInput({ warehouseInventoryId: 'w1', warehouseCode: 'HN' }))).toBe(true);
  });
  it('in_stock KHÔNG có kho và không đủ staging -> not covered', () => {
    expect(lineCovered(lineInput())).toBe(false);
  });
  it('picked / packed / shipped -> covered', () => {
    expect(lineCovered(lineInput({ status: 'picked' }))).toBe(true);
    expect(lineCovered(lineInput({ status: 'packed' }))).toBe(true);
    expect(lineCovered(lineInput({ status: 'shipped' }))).toBe(true);
  });
  it('pending_check / out_of_stock / brand_requested -> not covered', () => {
    expect(lineCovered(lineInput({ status: 'pending_check' }))).toBe(false);
    expect(lineCovered(lineInput({ status: 'out_of_stock' }))).toBe(false);
    expect(lineCovered(lineInput({ status: 'brand_requested' }))).toBe(false);
  });
  it('qty 0 không tự coi là covered nếu chưa có gì', () => {
    expect(lineCovered(lineInput({ qty: 0, stagedCount: 0 }))).toBe(false);
  });
});

// ── groupStaging ────────────────────────────────────────────────────

const item = (over: Partial<StagedItemRow> = {}): StagedItemRow => ({
  itemId: 'i1', unitCode: 'U-001', sku: 'SKU1', qcResult: 'pass',
  receiptCode: 'GR-001', stagedAt: new Date('2026-06-05'),
  lineId: 'l1', orderId: 'o1', orderNumber: '#1001',
  processedAt: new Date('2026-06-01'),
  ...over,
});

const line = (over: Partial<OrderLineRow> = {}): OrderLineRow => ({
  orderId: 'o1', lineId: 'l1', sku: 'SKU1', qty: 1, status: 'in_stock',
  allocatedQty: 0, warehouseInventoryId: null, warehouseCode: null,
  ...over,
});

describe('groupStaging — nhóm khu chờ theo đơn', () => {
  it('nhóm kiện theo đơn, đếm stagedCount theo dòng', () => {
    const groups = groupStaging(
      [
        item({ itemId: 'i1', lineId: 'l1' }),
        item({ itemId: 'i2', lineId: 'l1', unitCode: 'U-002' }),
        item({ itemId: 'i3', lineId: 'l2', orderId: 'o2', orderNumber: '#1002', processedAt: new Date('2026-06-02') }),
      ],
      [
        line({ lineId: 'l1', qty: 2 }),
        line({ orderId: 'o2', lineId: 'l2' }),
      ],
    );
    expect(groups).toHaveLength(2);
    const g1 = groups.find((g) => g.orderId === 'o1')!;
    expect(g1.stagedTotal).toBe(2);
    expect(g1.lines).toHaveLength(1);
    expect(g1.lines[0].stagedCount).toBe(2);
    expect(g1.items.map((i) => i.itemId)).toEqual(['i1', 'i2']);
  });

  it('sort đơn cũ nhất (processedAt) lên đầu', () => {
    const groups = groupStaging(
      [
        item({ itemId: 'i1', orderId: 'oNew', orderNumber: '#2', lineId: 'lN', processedAt: new Date('2026-06-08') }),
        item({ itemId: 'i2', orderId: 'oOld', orderNumber: '#1', lineId: 'lO', processedAt: new Date('2026-06-01') }),
      ],
      [line({ orderId: 'oNew', lineId: 'lN' }), line({ orderId: 'oOld', lineId: 'lO' })],
    );
    expect(groups.map((g) => g.orderId)).toEqual(['oOld', 'oNew']);
  });

  it('readyToGo khi MỌI dòng được che (staging đủ + kho + đã pick)', () => {
    const [g] = groupStaging(
      [item({ lineId: 'l1' })],
      [
        line({ lineId: 'l1', qty: 1 }),                                            // staging đủ
        line({ lineId: 'l2', warehouseInventoryId: 'w1', warehouseCode: 'HN' }),    // kho
        line({ lineId: 'l3', status: 'picked' }),                                   // đã pick
        line({ lineId: 'l4', status: 'shipped' }),                                  // đã đi
      ],
    );
    expect(g.readyToGo).toBe(true);
  });

  it('KHÔNG readyToGo khi còn dòng out_of_stock / pending_check / staging thiếu', () => {
    const base = [item({ lineId: 'l1' })];
    expect(groupStaging(base, [line({ lineId: 'l1' }), line({ lineId: 'l2', status: 'out_of_stock' })])[0].readyToGo).toBe(false);
    expect(groupStaging(base, [line({ lineId: 'l1' }), line({ lineId: 'l2', status: 'pending_check' })])[0].readyToGo).toBe(false);
    expect(groupStaging(base, [line({ lineId: 'l1', qty: 3 })])[0].readyToGo).toBe(false); // 1/3 kiện
  });

  it('oldestStagedAt = kiện về sớm nhất của đơn', () => {
    const [g] = groupStaging(
      [
        item({ itemId: 'i1', stagedAt: new Date('2026-06-07') }),
        item({ itemId: 'i2', stagedAt: new Date('2026-06-03') }),
      ],
      [line({ qty: 2 })],
    );
    expect(g.oldestStagedAt).toEqual(new Date('2026-06-03'));
  });

  it('dòng của đơn khác (không có kiện staging) không tạo nhóm', () => {
    const groups = groupStaging(
      [item()],
      [line(), line({ orderId: 'oKhac', lineId: 'lX' })],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].orderId).toBe('o1');
  });

  it('mảng rỗng -> []', () => {
    expect(groupStaging([], [])).toEqual([]);
  });
});
