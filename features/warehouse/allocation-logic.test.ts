import { describe, expect, it } from 'vitest';
import { pickWarehouse, planAllocation, fifoOrder, validateMovement, pickItem, skuUngVien, timUngVienCoMon } from './allocation-logic';

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

describe('pickItem (per-unit FIFO)', () => {
  it('chọn món in_stock cũ nhất ở kho nhiều khả dụng nhất (hoà → GVM)', () => {
    const items = [
      { id: 'b', warehouseCode: 'AP', receivedAt: new Date('2024-01-01') },
      { id: 'a', warehouseCode: 'GVM', receivedAt: new Date('2024-02-01') },
      { id: 'c', warehouseCode: 'GVM', receivedAt: new Date('2024-01-15') },
    ];
    // GVM có 2 món, AP 1 → chọn GVM; trong GVM cũ nhất = 'c' (2024-01-15).
    expect(pickItem(items)?.id).toBe('c');
  });
  it('rỗng → null', () => { expect(pickItem([])).toBeNull(); });
});

describe('skuUngVien — dòng đơn -sale phải tìm được tồn của SKU GỐC', () => {
  /* MMP dựng bản bán lại trên Shopify với SKU `<Global SKU>-sale`, nên đơn về mang SKU đó.
   * Nhưng kho giữ hàng dưới SKU GỐC — đó là CÙNG MỘT CHIẾC, không phải mặt hàng mới
   * (hợp đồng `docs/mmp/resale-ton-kho.md`, mục "Đơn hàng SKU -sale").
   *
   * Đo 26/10/2026 trước khi sửa: 622/628 dòng `-Sale` nằm ở `out_of_stock` và KHÔNG dòng nào
   * nối tới tồn — allocator tra đúng `X-Sale` trong `goods_receipt_items`, không thấy, rồi
   * đánh hết hàng. Suốt hai năm, và nó không kêu vì `out_of_stock` là trạng thái hợp lệ.
   *
   * Thứ tự ỨNG VIÊN có nghĩa: thử SKU NGUYÊN VĂN trước. Có 16 dòng tồn ghi ngay dưới SKU
   * `-Sale` (bản bán lại dựng tay từ 2024), nên nếu kho đã earmark đúng chiếc cho bản sale
   * thì phải lấy chiếc đó, chỉ khi không có mới mượn tồn của SKU gốc. */
  it('SKU thường: chỉ một ứng viên, giữ nguyên hành vi cũ', () => {
    expect(skuUngVien('Denio-DN0813-S-WWHI-PLA')).toEqual(['Denio-DN0813-S-WWHI-PLA']);
  });

  it('SKU -sale: nguyên văn TRƯỚC, rồi SKU gốc', () => {
    expect(skuUngVien('MIRER-AND-BLK-S-sale')).toEqual(['MIRER-AND-BLK-S-sale', 'MIRER-AND-BLK-S']);
  });

  /** Dữ liệu thật dùng `-Sale` chữ S hoa. */
  it('nhận -Sale chữ hoa', () => {
    expect(skuUngVien('IHF-26F0223000912-S-BLA-Sale')).toEqual([
      'IHF-26F0223000912-S-BLA-Sale', 'IHF-26F0223000912-S-BLA',
    ]);
  });

  /** Ca thật: `...-PO-Sale` chỉ bóc một lớp, không ăn `-PO`. */
  it('chỉ bóc một lớp đuôi', () => {
    expect(skuUngVien('Denio-DN0774+PKDN0729-S-NALM-PLA-PO-Sale')).toEqual([
      'Denio-DN0774+PKDN0729-S-NALM-PLA-PO-Sale', 'Denio-DN0774+PKDN0729-S-NALM-PLA-PO',
    ]);
  });

  it('không trả ứng viên trùng nhau', () => {
    expect(skuUngVien('X')).toEqual(['X']);
    expect(new Set(skuUngVien('X-sale')).size).toBe(2);
  });
});

describe('timUngVienCoMon — dừng ở ứng viên ĐẦU TIÊN có món, và trả đúng SKU ghi sổ', () => {
  /* Đây là phần dễ sai nhất của bản vá `-sale`, và nó nằm ở tầng I/O nên không test thuần
   * nào với tới. Bóc ra đây để ghim được HAI tính chất:
   *  1. SKU trả về là SKU của CHIẾC, dùng để ghi sổ cái. Ghi theo SKU dòng đơn khi mượn tồn
   *     SKU gốc sẽ dựng một dòng `warehouse_inventory` mới cho `X-sale` và giữ chỗ ở đó,
   *     trong khi chiếc hàng bị trừ khỏi kho của `X` — ĐẾM TRÙNG.
   *  2. DỪNG ở ứng viên đầu tiên có món, không trộn hai SKU vào một lượt chọn — để FIFO vẫn
   *     là FIFO trong phạm vi một SKU. */
  const mon = (id: string) => ({ id, warehouseCode: 'GVM', receivedAt: null });

  it('SKU nguyên văn có món → dùng nó, KHÔNG tra tiếp SKU gốc', async () => {
    const daTra: string[] = [];
    const r = await timUngVienCoMon(['X-sale', 'X'], async (s) => {
      daTra.push(s);
      return s === 'X-sale' ? [mon('a')] : [mon('b')];
    });
    expect(r.sku).toBe('X-sale');
    expect(r.items.map((i) => i.id)).toEqual(['a']);
    expect(daTra).toEqual(['X-sale']); // dừng luôn, không tra 'X'
  });

  it('nguyên văn RỖNG → mượn tồn SKU gốc, và SKU ghi sổ là SKU GỐC', async () => {
    const r = await timUngVienCoMon(['X-sale', 'X'], async (s) => (s === 'X' ? [mon('b')] : []));
    expect(r.sku).toBe('X');
    expect(r.items.map((i) => i.id)).toEqual(['b']);
  });

  it('cả hai rỗng → trả ứng viên đầu và không món nào', async () => {
    const r = await timUngVienCoMon(['X-sale', 'X'], async () => []);
    expect(r.sku).toBe('X-sale');
    expect(r.items).toEqual([]);
  });

  it('SKU thường: tra đúng một lần', async () => {
    const daTra: string[] = [];
    const r = await timUngVienCoMon(['X'], async (s) => { daTra.push(s); return [mon('a')]; });
    expect(r.sku).toBe('X');
    expect(daTra).toEqual(['X']);
  });
});
