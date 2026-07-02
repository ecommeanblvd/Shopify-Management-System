import { describe, it, expect } from 'vitest';
import {
  shouldCreateSale,
  larkRowEligible,
  buildProductSetInput,
  chunk,
  bucketBySku,
  type EligibilityInput,
  type OrigProduct,
  type OrigVariant,
} from './create-sale-logic';

function eligible(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    isCustomize: false,
    hasMeanBlvdProduct: false,
    hasSaleProduct: false,
    originalStatus: 'ARCHIVED',
    larkEligible: true,
    sellable: 3,
    ...over,
  };
}

describe('shouldCreateSale', () => {
  it('happy path: tất cả pass → ok', () => {
    expect(shouldCreateSale(eligible())).toEqual({ ok: true, reason: 'ok' });
  });

  it('customize → reject', () => {
    const r = shouldCreateSale(eligible({ isCustomize: true }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('customize');
  });

  it('sellable <= 0 → reject', () => {
    expect(shouldCreateSale(eligible({ sellable: 0 })).ok).toBe(false);
    expect(shouldCreateSale(eligible({ sellable: 0 })).reason).toBe('no-sellable-stock');
    expect(shouldCreateSale(eligible({ sellable: -5 })).ok).toBe(false);
  });

  it('original không tìm thấy (null) → reject', () => {
    const r = shouldCreateSale(eligible({ originalStatus: null }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('original-not-found');
  });

  it('original ACTIVE / DRAFT (chưa ARCHIVED) → reject', () => {
    const active = shouldCreateSale(eligible({ originalStatus: 'ACTIVE' }));
    expect(active.ok).toBe(false);
    expect(active.reason).toContain('original-not-archived');
    expect(shouldCreateSale(eligible({ originalStatus: 'DRAFT' })).ok).toBe(false);
  });

  it('đã có product MEAN BLVD cho SKU → reject', () => {
    const r = shouldCreateSale(eligible({ hasMeanBlvdProduct: true }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('meanblvd-product-exists');
  });

  it('đã có product -Sale → reject', () => {
    const r = shouldCreateSale(eligible({ hasSaleProduct: true }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sale-product-exists');
  });

  it('Lark không hợp lệ → reject', () => {
    const r = shouldCreateSale(eligible({ larkEligible: false }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('lark-not-eligible');
  });
});

describe('larkRowEligible', () => {
  it('Tồn kho TQ + QC Pass + Lưu kho → true', () => {
    expect(
      larkRowEligible({ inventoryType: 'Tồn kho TQ', qcCheck: 'QC Pass', whAction: 'Lưu kho' }),
    ).toBe(true);
  });

  it('Tồn kho Return + qc pass (khác hoa/thường) + Lưu kho → true', () => {
    expect(
      larkRowEligible({ inventoryType: 'Tồn kho Return', qcCheck: 'qc pass', whAction: 'Lưu kho' }),
    ).toBe(true);
  });

  it('trim whitespace vẫn true', () => {
    expect(
      larkRowEligible({ inventoryType: '  Tồn kho TQ ', qcCheck: ' QC Pass ', whAction: ' Lưu kho ' }),
    ).toBe(true);
  });

  it('WH-Action sai → false', () => {
    expect(
      larkRowEligible({ inventoryType: 'Tồn kho TQ', qcCheck: 'QC Pass', whAction: 'Xuất kho' }),
    ).toBe(false);
  });

  it('QC không pass → false', () => {
    expect(
      larkRowEligible({ inventoryType: 'Tồn kho TQ', qcCheck: 'QC Fail', whAction: 'Lưu kho' }),
    ).toBe(false);
  });

  it('inventory type không phải "Tồn kho..." → false', () => {
    expect(
      larkRowEligible({ inventoryType: 'Đặt trước', qcCheck: 'QC Pass', whAction: 'Lưu kho' }),
    ).toBe(false);
  });
});

describe('buildProductSetInput', () => {
  function orig(over: Partial<OrigProduct> = {}): OrigProduct {
    return {
      title: 'Áo thun ABC',
      descriptionHtml: '<p>mô tả</p>',
      productType: 'Áo',
      tags: ['summer', 'sale'],
      optionNames: ['Size', 'Color'],
      imageUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
      ...over,
    };
  }

  const variants: OrigVariant[] = [
    {
      sku: 'ABC-S',
      price: '250000',
      selectedOptions: [
        { name: 'Size', value: 'S' },
        { name: 'Color', value: 'Đen' },
      ],
    },
    {
      sku: 'ABC-M',
      price: '250000',
      selectedOptions: [
        { name: 'Size', value: 'M' },
        { name: 'Color', value: 'Đen' },
      ],
    },
  ];

  it('vendor MEAN BLVD, status ACTIVE', () => {
    const input = buildProductSetInput(orig(), variants) as Record<string, unknown>;
    expect(input.vendor).toBe('MEAN BLVD');
    expect(input.status).toBe('ACTIVE');
  });

  it('files: 1 file / imageUrl, contentType IMAGE', () => {
    const input = buildProductSetInput(orig(), variants) as {
      files: { originalSource: string; contentType: string }[];
    };
    expect(input.files).toHaveLength(2);
    expect(input.files[0]).toEqual({ originalSource: 'https://cdn/a.jpg', contentType: 'IMAGE' });
  });

  it('1 variant / input variant, SKU có -Sale (từ base chuẩn hoá)', () => {
    const input = buildProductSetInput(orig(), variants) as {
      variants: { inventoryItem: { sku: string; tracked: boolean }; price: string; optionValues: unknown[] }[];
    };
    expect(input.variants).toHaveLength(2);
    expect(input.variants[0].inventoryItem).toEqual({ sku: 'ABC-S-Sale', tracked: true });
    expect(input.variants[1].inventoryItem.sku).toBe('ABC-M-Sale');
    expect(input.variants[0].price).toBe('250000');
  });

  it('SKU đã có -Sale/-PLA suffix vẫn normalize rồi append -Sale (không nhân đôi)', () => {
    const input = buildProductSetInput(orig(), [
      { sku: 'ABC-S-Sale', price: '9', selectedOptions: [{ name: 'Size', value: 'S' }] },
    ]) as { variants: { inventoryItem: { sku: string } }[] };
    // normSku('ABC-S-Sale') = 'ABC-S' → append '-Sale' → 'ABC-S-Sale' (không nhân đôi)
    expect(input.variants[0].inventoryItem.sku).toBe('ABC-S-Sale');
  });

  it('optionValues map {optionName,name} theo selectedOptions', () => {
    const input = buildProductSetInput(orig(), variants) as {
      variants: { optionValues: { optionName: string; name: string }[] }[];
    };
    expect(input.variants[0].optionValues).toEqual([
      { optionName: 'Size', name: 'S' },
      { optionName: 'Color', name: 'Đen' },
    ]);
  });

  it('productOptions gom value duy nhất theo optionName', () => {
    const input = buildProductSetInput(orig(), variants) as {
      productOptions: { name: string; values: { name: string }[] }[];
    };
    const size = input.productOptions.find((o) => o.name === 'Size');
    const color = input.productOptions.find((o) => o.name === 'Color');
    expect(size?.values).toEqual([{ name: 'S' }, { name: 'M' }]);
    expect(color?.values).toEqual([{ name: 'Đen' }]);
  });
});

describe('chunk', () => {
  it('chia mảng thành các lô đúng kích thước', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('lô cuối lấy phần dư', () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('mảng rỗng → []', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('size <= 0 → 1 lô chứa toàn bộ (không chia vô hạn)', () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
  });
});

describe('bucketBySku', () => {
  it('gom node theo SKU chuẩn hoá (trim + UPPERCASE)', () => {
    const nodes = [
      { sku: 'abc', v: 1 },
      { sku: ' ABC ', v: 2 },
      { sku: 'X-Sale', v: 3 },
    ];
    const m = bucketBySku(nodes);
    expect(m.get('ABC')).toEqual([{ sku: 'abc', v: 1 }, { sku: ' ABC ', v: 2 }]);
    expect(m.get('X-SALE')).toEqual([{ sku: 'X-Sale', v: 3 }]);
  });

  it('bỏ qua node sku null / rỗng', () => {
    const m = bucketBySku([{ sku: null }, { sku: '   ' }, { sku: 'A' }]);
    expect(m.has('')).toBe(false);
    expect([...m.keys()]).toEqual(['A']);
  });

  it('SKU vắng mặt → get trả undefined', () => {
    const m = bucketBySku([{ sku: 'A' }]);
    expect(m.get('B')).toBeUndefined();
  });
});
