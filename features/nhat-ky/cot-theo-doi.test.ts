import { describe, it, expect } from 'vitest';
import { CAU_HINH, cotDuocGhi, laThayDoi } from './cot-theo-doi';

describe('cotDuocGhi', () => {
  it('chế độ "trừ" ghi mọi cột trừ danh sách loại trừ', () => {
    const ch = { bang: 'goods_receipt_items', cheDo: 'tru' as const, cot: ['updated_at', 'created_at'] };
    expect(cotDuocGhi(ch, ['id', 'qc_result', 'updated_at'])).toEqual(['id', 'qc_result']);
  });

  it('chế độ "cho-phép" chỉ ghi cột trong danh sách, cột lạ bị bỏ', () => {
    const ch = { bang: 'shopify_orders', cheDo: 'cho-phep' as const, cot: ['selected_carrier_key'] };
    expect(cotDuocGhi(ch, ['id', 'raw_payload', 'selected_carrier_key'])).toEqual(['selected_carrier_key']);
  });

  it('cho-phép KHÔNG kéo theo cột lạ dù tên giống khuôn', () => {
    const ch = { bang: 'shopify_orders', cheDo: 'cho-phep' as const, cot: ['cost_override'] };
    expect(cotDuocGhi(ch, ['cost_override_2', 'cost_override'])).toEqual(['cost_override']);
  });
});

describe('laThayDoi', () => {
  it('NULL sang chuỗi rỗng LÀ thay đổi', () => { expect(laThayDoi(null, '')).toBe(true); });
  it('chuỗi rỗng sang NULL LÀ thay đổi', () => { expect(laThayDoi('', null)).toBe(true); });
  it('hai giá trị giống nhau KHÔNG phải thay đổi', () => { expect(laThayDoi('pass', 'pass')).toBe(false); });
  it('hai NULL KHÔNG phải thay đổi', () => { expect(laThayDoi(null, null)).toBe(false); });
});

describe('CAU_HINH', () => {
  it('goods_receipt_items nối lên lô qua receipt_id', () => {
    const ch = CAU_HINH.find((x) => x.bang === 'goods_receipt_items');
    expect(ch?.cotCha).toBe('receipt_id');
    expect(ch?.bangCha).toBe('goods_receipts');
  });

  it('ba bảng con đều khai cột cha và bảng cha', () => {
    const cha = Object.fromEntries(
      CAU_HINH.filter((x) => x.cotCha).map((x) => [x.bang, [x.cotCha, x.bangCha]]),
    );
    expect(cha).toEqual({
      goods_receipt_items: ['receipt_id', 'goods_receipts'],
      shopify_order_lines: ['order_id', 'shopify_orders'],
      order_fulfillment_lines: ['fulfillment_id', 'order_fulfillment'],
    });
  });

  it('khai đủ 10 bảng, không trùng', () => {
    expect(CAU_HINH.map((x) => x.bang).sort()).toEqual([
      'goods_receipt_items', 'goods_receipts', 'inventory_movements', 'order_fulfillment',
      'order_fulfillment_lines', 'ship_ho_orders', 'shipments', 'shopify_order_lines',
      'shopify_orders', 'warehouse_inventory',
    ]);
  });

  it('mọi bảng trong CAU_HINH loại trừ updated_at và created_at', () => {
    for (const ch of CAU_HINH.filter((x) => x.cheDo === 'tru')) {
      expect(ch.cot).toContain('updated_at');
      expect(ch.cot).toContain('created_at');
    }
  });

  it('shopify_orders dùng cho-phép và KHÔNG có raw_payload', () => {
    const ch = CAU_HINH.find((x) => x.bang === 'shopify_orders');
    expect(ch?.cheDo).toBe('cho-phep');
    expect(ch?.cot).not.toContain('raw_payload');
  });

  it('hai bảng máy ghi không bao giờ cho phép raw_payload', () => {
    for (const ch of CAU_HINH.filter((x) => x.cheDo === 'cho-phep')) {
      expect(ch.cot).not.toContain('raw_payload');
    }
  });

  it('shopify_order_lines ghi số lượng, đơn giá, tổng, SKU và cost_override', () => {
    const ch = CAU_HINH.find((x) => x.bang === 'shopify_order_lines');
    expect(ch?.cheDo).toBe('cho-phep');
    expect([...(ch?.cot ?? [])].sort()).toEqual(['cost_override', 'quantity', 'sku', 'total', 'unit_price']);
  });
});

/**
 * Minor #6 của lượt soát cuối: `id` nằm trong danh sách theo dõi.
 *
 * `id` không đổi được nên không có dòng `sua` nào, nhưng trigger ghi MỌI cột có giá trị ở
 * ca `INSERT`/`DELETE` — mỗi lần thêm/xoá một bản ghi là một dòng `truong='id'` trùng y
 * `ban_ghi_id`. Rác trên màn hình, và nó đội CHÍNH con số dòng/ngày mà §8 dùng để quyết
 * mở rộng.
 */
describe('id không bao giờ vào nhật ký', () => {
  it('bảng chế độ `tru` loại `id` ra', () => {
    for (const ch of CAU_HINH) {
      if (ch.cheDo !== 'tru') continue;
      expect(cotDuocGhi(ch, ['id', 'unit_code', 'qc_result']), `bảng ${ch.bang}`)
        .not.toContain('id');
    }
  });

  it('bảng chế độ `cho-phep` cũng không khai `id`', () => {
    for (const ch of CAU_HINH) {
      if (ch.cheDo !== 'cho-phep') continue;
      expect([...ch.cot], `bảng ${ch.bang}`).not.toContain('id');
    }
  });

  it('loại `id` nhưng KHÔNG loại oan cột khác', () => {
    const ch = CAU_HINH.find((c) => c.bang === 'goods_receipt_items')!;
    expect(cotDuocGhi(ch, ['id', 'unit_code', 'qc_result', 'updated_at']))
      .toEqual(['unit_code', 'qc_result']);
  });
});
