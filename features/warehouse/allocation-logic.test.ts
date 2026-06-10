import { describe, expect, it } from 'vitest';
import { pickWarehouse, planAllocation, fifoOrder, validateMovement } from './allocation-logic';

describe('pickWarehouse', () => {
  it('chọn kho khả dụng nhiều hơn', () => {
    expect(pickWarehouse([{ code: 'HN', available: 1 }, { code: 'SG', available: 5 }])).toBe('SG');
  });
  it('hoà -> HN', () => {
    expect(pickWarehouse([{ code: 'SG', available: 3 }, { code: 'HN', available: 3 }])).toBe('HN');
  });
  it('không kho nào có hàng -> null', () => {
    expect(pickWarehouse([{ code: 'HN', available: 0 }, { code: 'SG', available: 0 }])).toBeNull();
  });
  it('mảng rỗng -> null', () => {
    expect(pickWarehouse([])).toBeNull();
  });
  it('hoà giữa 2 kho non-HN -> alphabet', () => {
    expect(pickWarehouse([{ code: 'SG', available: 2 }, { code: 'DN', available: 2 }])).toBe('DN');
  });
});

describe('planAllocation — đủ-hoặc-không (v1, không partial)', () => {
  it('đủ ở một kho -> cấp từ kho đó', () => {
    expect(planAllocation({ qty: 2 }, [
      { code: 'HN', available: 1 }, { code: 'SG', available: 3 },
    ])).toEqual({ warehouseCode: 'SG', qty: 2 });
  });
  it('tổng 2 kho đủ nhưng mỗi kho thiếu -> null (không tách kiện v1)', () => {
    expect(planAllocation({ qty: 4 }, [
      { code: 'HN', available: 2 }, { code: 'SG', available: 3 },
    ])).toBeNull();
  });
  it('qty 0 -> null', () => {
    expect(planAllocation({ qty: 0 }, [{ code: 'HN', available: 9 }])).toBeNull();
  });
  it('available === qty đúng biên -> cấp', () => {
    expect(planAllocation({ qty: 3 }, [{ code: 'HN', available: 3 }])).toEqual({ warehouseCode: 'HN', qty: 3 });
  });
  it('qty âm -> null', () => {
    expect(planAllocation({ qty: -1 }, [{ code: 'HN', available: 9 }])).toBeNull();
  });
});

describe('fifoOrder', () => {
  it('đơn về trước đứng trước; null processedAt xuống cuối', () => {
    const lines = [
      { id: 'b', orderProcessedAt: new Date('2026-06-02') },
      { id: 'c', orderProcessedAt: null },
      { id: 'a', orderProcessedAt: new Date('2026-06-01') },
    ];
    expect(fifoOrder(lines).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('validateMovement', () => {
  const inv = { qtyOnHand: 5, qtyReserved: 2 };
  it('hợp lệ: nhập kho', () => {
    expect(validateMovement(inv, { deltaOnHand: 3, deltaReserved: 0 })).toEqual({ ok: true });
  });
  it('chặn on-hand âm', () => {
    expect(validateMovement(inv, { deltaOnHand: -6, deltaReserved: 0 }).ok).toBe(false);
  });
  it('chặn reserved âm', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: -3 }).ok).toBe(false);
  });
  it('chặn reserved vượt on-hand', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: 4 }).ok).toBe(false);
  });
  it('chặn movement rỗng (cả hai delta = 0)', () => {
    expect(validateMovement(inv, { deltaOnHand: 0, deltaReserved: 0 }).ok).toBe(false);
  });
  it('chặn delta NaN/không nguyên', () => {
    expect(validateMovement(inv, { deltaOnHand: NaN, deltaReserved: 0 }).ok).toBe(false);
  });
  it('reserved chạm đúng on-hand -> ok', () => {
    expect(validateMovement({ qtyOnHand: 5, qtyReserved: 2 }, { deltaOnHand: 0, deltaReserved: 3 })).toEqual({ ok: true });
  });
});
