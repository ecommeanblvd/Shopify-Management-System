import { describe, expect, it } from 'vitest';
import {
  larkStockCounts,
  reconcilePlan,
  type CurrentInv,
  type LarkStockRow,
} from './lark-sync-logic';

describe('larkStockCounts', () => {
  it('2 dòng cùng sku+kho → TỔNG finalStock (1+2 = 3)', () => {
    const rows: LarkStockRow[] = [
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1 },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 2 },
    ];
    const m = larkStockCounts(rows);
    expect(m.get('A|GVM')?.qty).toBe(3);
    expect(m.size).toBe(1);
  });

  it('dòng finalStock trống → cộng 0', () => {
    const rows: LarkStockRow[] = [
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 2 },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 0 },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: NaN },
    ];
    const m = larkStockCounts(rows);
    expect(m.get('A|GVM')?.qty).toBe(2);
  });

  it('map kho "HN | GVM" → GVM', () => {
    const m = larkStockCounts([{ sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1 }]);
    expect([...m.keys()]).toEqual(['A|GVM']);
  });

  it('khác kho → nhóm riêng', () => {
    const rows: LarkStockRow[] = [
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 4 },
      { sku: 'A', warehouseRaw: 'SG | AP', finalStock: 5 },
    ];
    const m = larkStockCounts(rows);
    expect(m.get('A|GVM')?.qty).toBe(4);
    expect(m.get('A|AP')?.qty).toBe(5);
  });

  it('sku rỗng/null bị bỏ', () => {
    const rows: LarkStockRow[] = [
      { sku: '', warehouseRaw: 'HN | GVM', finalStock: 9 },
      { sku: null, warehouseRaw: 'HN | GVM', finalStock: 9 },
      { sku: '   ', warehouseRaw: 'HN | GVM', finalStock: 9 },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1 },
    ];
    const m = larkStockCounts(rows);
    expect(m.size).toBe(1);
    expect(m.get('A|GVM')?.qty).toBe(1);
  });

  it('giữ productTitle đầu tiên gặp được', () => {
    const rows: LarkStockRow[] = [
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1, productTitle: null },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1, productTitle: 'Áo thun' },
    ];
    const m = larkStockCounts(rows);
    expect(m.get('A|GVM')?.productTitle).toBe('Áo thun');
  });
});

describe('reconcilePlan', () => {
  it('SKU mới → isNew, delta = qty', () => {
    const lark = larkStockCounts([
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1, productTitle: 'Áo' },
      { sku: 'A', warehouseRaw: 'HN | GVM', finalStock: 1 },
    ]);
    const plan = reconcilePlan(lark, []);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      sku: 'A', warehouseCode: 'GVM', deltaOnHand: 2, targetOnHand: 2,
      isNew: true, cappedByReserved: false, productTitle: 'Áo',
    });
  });

  it('tăng tồn', () => {
    const lark = new Map([['A|GVM', { qty: 5 }]]);
    const current: CurrentInv[] = [{ sku: 'A', warehouseCode: 'GVM', qtyOnHand: 3, qtyReserved: 1 }];
    const plan = reconcilePlan(lark, current);
    expect(plan[0]).toMatchObject({ deltaOnHand: 2, targetOnHand: 5, isNew: false, cappedByReserved: false });
  });

  it('giảm tồn', () => {
    const lark = new Map([['A|GVM', { qty: 2 }]]);
    const current: CurrentInv[] = [{ sku: 'A', warehouseCode: 'GVM', qtyOnHand: 5, qtyReserved: 0 }];
    const plan = reconcilePlan(lark, current);
    expect(plan[0]).toMatchObject({ deltaOnHand: -3, targetOnHand: 2, cappedByReserved: false });
  });

  it('SKU biến mất khỏi Lark → target 0 → delta âm về 0', () => {
    const lark = new Map<string, { qty: number }>();
    const current: CurrentInv[] = [{ sku: 'A', warehouseCode: 'GVM', qtyOnHand: 4, qtyReserved: 0 }];
    const plan = reconcilePlan(lark, current);
    expect(plan[0]).toMatchObject({ deltaOnHand: -4, targetOnHand: 0, isNew: false, cappedByReserved: false });
  });

  it('biến mất nhưng đang giữ (reserved) → chặn ở reserved, cappedByReserved', () => {
    const lark = new Map<string, { qty: number }>();
    const current: CurrentInv[] = [{ sku: 'A', warehouseCode: 'GVM', qtyOnHand: 5, qtyReserved: 2 }];
    const plan = reconcilePlan(lark, current);
    // effectiveTarget = max(0, 2) = 2 → delta = 2 - 5 = -3
    expect(plan[0]).toMatchObject({ deltaOnHand: -3, targetOnHand: 2, cappedByReserved: true });
  });

  it('không đổi → bỏ qua', () => {
    const lark = new Map([['A|GVM', { qty: 3 }]]);
    const current: CurrentInv[] = [{ sku: 'A', warehouseCode: 'GVM', qtyOnHand: 3, qtyReserved: 1 }];
    expect(reconcilePlan(lark, current)).toHaveLength(0);
  });
});
