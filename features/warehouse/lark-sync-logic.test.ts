import { describe, expect, it } from 'vitest';
import {
  larkNumber,
  larkStockCounts,
  reconcilePlan,
  type CurrentInv,
  type LarkStockRow,
} from './lark-sync-logic';

describe('larkNumber (field công thức Lark)', () => {
  it('shape công thức {type,value:[n]} → số', () => {
    expect(larkNumber({ type: 2, value: [1] })).toBe(1);
    expect(larkNumber({ type: 2, value: [3] })).toBe(3);
  });
  it('number / mảng / text / trống', () => {
    expect(larkNumber(2)).toBe(2);
    expect(larkNumber([2])).toBe(2);
    expect(larkNumber('4')).toBe(4);
    expect(larkNumber(null)).toBe(0);
    expect(larkNumber('')).toBe(0);
    expect(larkNumber({})).toBe(0);
  });
});

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

import { lyDoTuChoiGhi, phanLoaiVeKhong } from './lark-sync-logic';

describe('lyDoTuChoiGhi (chốt chặn ghi thật)', () => {
  const cur = (n: number) => Array.from({ length: n }, (_, i) => ({
    sku: `S${i}`, warehouseCode: 'GVM', qtyOnHand: 5, qtyReserved: 0,
  }));
  const ve0 = (n: number) => Array.from({ length: n }, (_, i) => ({
    sku: `S${i}`, warehouseCode: 'GVM', deltaOnHand: -5, targetOnHand: 0, cappedByReserved: false, isNew: false,
  }));
  it('Lark rỗng → từ chối', () => {
    expect(lyDoTuChoiGhi(0, [], cur(100))).toMatch(/0 dòng/);
  });
  it('về 0 vượt trần → từ chối; dưới trần → cho ghi', () => {
    expect(lyDoTuChoiGhi(500, ve0(60), cur(100))).toMatch(/quá bất thường/);
    expect(lyDoTuChoiGhi(500, ve0(20), cur(100))).toBeNull();
  });
  it('kho nhỏ vẫn có trần tối thiểu 20', () => {
    expect(lyDoTuChoiGhi(50, ve0(10), cur(10))).toBeNull();
  });
});

describe('phanLoaiVeKhong — tách "Lark nói 0" khỏi "Lark im"', () => {
  /* Vì sao bài này quan trọng hơn vẻ ngoài: `reconcilePlan` coi dòng VẮNG trên Lark là
   * "đích = 0" (`:97`), nên con số `zeroed` của chốt chặn trộn hai nguyên nhân khác hẳn
   * nhau — "Lark bảo hết hàng" (tin được) và "Lark không nhắc tới dòng này" (không kết
   * luận được, có thể chỉ là view bị sửa bộ lọc). Thông điệp từ chối hiện tại nói "quá
   * bất thường, xem kế hoạch rồi quyết" mà không in ra đúng cái tách này, nên người xem
   * không có cách nào quyết. Đo thật 25/10/2026: 351/882 dòng bị đưa về 0. */
  const cur = (sku: string, wh: string, onHand: number) => ({ sku, warehouseCode: wh, qtyOnHand: onHand, qtyReserved: 0 });

  it('Lark CÓ dòng và nói 0 → nhóm larkNoi0', () => {
    const lark = new Map([['A|GVM', { qty: 0 }]]);
    const plan = reconcilePlan(lark, [cur('A', 'GVM', 5)]);
    const r = phanLoaiVeKhong(lark, plan);
    expect(r.larkNoi0.map((p) => p.sku)).toEqual(['A']);
    expect(r.larkIm).toEqual([]);
    expect(r.chiecMatLarkNoi0).toBe(5);
  });

  it('Lark KHÔNG có cặp (sku,kho) → nhóm larkIm, KHÔNG phải larkNoi0', () => {
    const lark = new Map<string, { qty: number }>();
    const plan = reconcilePlan(lark, [cur('B', 'GVM', 3)]);
    const r = phanLoaiVeKhong(lark, plan);
    expect(r.larkNoi0).toEqual([]);
    expect(r.larkIm.map((p) => p.sku)).toEqual(['B']);
    expect(r.chiecMatLarkIm).toBe(3);
  });

  /* Dấu hiệu LỆCH ÁNH XẠ KHO, không phải hết hàng: SMS ghi hàng ở kho X, Lark có đúng SKU
   * đó nhưng ở kho Y. Gộp nó vào "Lark im" là kết luận sai thành "hết hàng" rồi xoá tồn. */
  it('SKU có trong Lark nhưng KHO KHÁC → đánh dấu nghi lệch ánh xạ kho', () => {
    const lark = new Map([['C|AP', { qty: 4 }]]);
    const plan = reconcilePlan(lark, [cur('C', 'GVM', 4)]);
    const r = phanLoaiVeKhong(lark, plan);
    expect(r.larkIm.map((p) => p.sku)).toEqual(['C']);
    expect(r.khoKhac.map((p) => p.sku)).toEqual(['C']);
    expect(r.larkImThatSu).toEqual([]);
  });

  it('SKU không hề xuất hiện trong Lark → larkImThatSu', () => {
    const lark = new Map([['Z|GVM', { qty: 1 }]]);
    const plan = reconcilePlan(lark, [cur('D', 'GVM', 2), cur('Z', 'GVM', 1)]);
    const r = phanLoaiVeKhong(lark, plan);
    expect(r.larkImThatSu.map((p) => p.sku)).toEqual(['D']);
    expect(r.khoKhac).toEqual([]);
  });

  /* Dòng MỚI (Lark có, SMS chưa) không bao giờ là "về 0" — đừng đếm lẫn. */
  it('dòng thêm mới không nằm trong nhóm nào', () => {
    const lark = new Map([['E|GVM', { qty: 7 }]]);
    const r = phanLoaiVeKhong(lark, reconcilePlan(lark, []));
    expect(r.larkNoi0).toEqual([]);
    expect(r.larkIm).toEqual([]);
  });

  /* Dòng bị `qty_reserved` chặn không về được 0 → không phải "về 0". */
  it('dòng bị reserved giữ lại không tính là về 0', () => {
    const lark = new Map([['F|GVM', { qty: 0 }]]);
    const plan = reconcilePlan(lark, [{ sku: 'F', warehouseCode: 'GVM', qtyOnHand: 5, qtyReserved: 2 }]);
    const r = phanLoaiVeKhong(lark, plan);
    expect(r.larkNoi0).toEqual([]);
    expect(r.larkIm).toEqual([]);
  });
});
