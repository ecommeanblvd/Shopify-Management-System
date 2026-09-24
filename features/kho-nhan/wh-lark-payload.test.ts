import { describe, it, expect } from 'vitest';
import {
  dungPayloadNhan, dungPayloadSauQcDat,
  WH_ACTION_CHO_QC, WH_ACTION_TAM_NHAP, INVENTORY_TYPE_RETAIL,
} from './wh-lark-payload';

describe('giá trị cột chọn phải khớp NGUYÊN VĂN tên lựa chọn trên Lark', () => {
  it('"Chờ QC" có dấu cách CẢ HAI ĐẦU — trim là đẻ lựa chọn mới trên bảng vận hành', () => {
    expect(WH_ACTION_CHO_QC).toBe(' Chờ QC ');
    expect(WH_ACTION_CHO_QC).toHaveLength(8);
    expect(WH_ACTION_CHO_QC.trim()).not.toBe(WH_ACTION_CHO_QC);
  });
  it('"Tạm nhập (đi đơn)" KHÔNG có dấu cách thừa', () => {
    expect(WH_ACTION_TAM_NHAP).toBe('Tạm nhập (đi đơn)');
    expect(WH_ACTION_TAM_NHAP).toHaveLength(17);
  });
  it('inventory type là "Retail"', () => {
    expect(INVENTORY_TYPE_RETAIL).toBe('Retail');
  });
});

describe('dungPayloadNhan', () => {
  const luc = new Date('2026-09-24T10:00:00Z');

  it('đủ bảy cột, không thừa cột nào', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', maDon: '#MBLVD30542', sku: 'TomFried-TS2644-S-KPTT-PLA', nhanLuc: luc, kho: 'GVM' });
    expect(Object.keys(p).sort()).toEqual([
      'Import (select order)', 'Import - Inventory type', 'Lineitem SKU final',
      'Ngày Import - tiếp nhận đồ tại kho', 'Order Number final',
      'WH - Action', 'Warehouse',
    ]);
  });

  it('cột liên kết nhận MẢNG record_id, không phải chuỗi', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', maDon: '#MBLVD30542', sku: 'TomFried-TS2644-S-KPTT-PLA', nhanLuc: luc, kho: 'GVM' });
    expect(p['Import (select order)']).toEqual(['recABC']);
  });

  it('ngày ghi bằng mốc thời gian epoch, đúng kiểu date của Lark', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'GVM' });
    expect(p['Ngày Import - tiếp nhận đồ tại kho']).toBe(luc.getTime());
  });

  it('lúc NHẬN là "Chờ QC", KHÔNG phải "Tạm nhập" — hàng chưa kiểm thì chưa nhập kho', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'GVM' });
    expect(p['WH - Action']).toBe(' Chờ QC ');
  });

  /* Cột `… (look up)` Lark tự sinh từ liên kết — điền tay vào là Lark từ chối.
   * Khác hẳn cột `… final`, vốn là Text và PHẢI điền (xem nhóm test cuối file). */
  it('KHÔNG điền tay các cột Lark tự lookup', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'GVM' });
    for (const k of ['Lineitem SKU (look up)', 'Order number (look up)', 'Brand', 'Định danh']) {
      expect(p).not.toHaveProperty(k);
    }
  });
});

describe('dungPayloadSauQcDat', () => {
  it('chỉ đổi ĐÚNG một cột, không đụng ngày hay liên kết', () => {
    expect(dungPayloadSauQcDat()).toEqual({ 'WH - Action': 'Tạm nhập (đi đơn)' });
  });
});


describe('cột Warehouse — thiếu là record VÔ HÌNH trên mọi view', () => {
  const luc = new Date('2026-09-24T10:00:00Z');
  it('ba kho của hệ thống map đúng tên lựa chọn trên Lark', () => {
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'GVM' }).Warehouse).toBe('HN | GVM');
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'AP' }).Warehouse).toBe('SG | AP');
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'DM' }).Warehouse).toBe('SG | DM');
  });
  it('kho lạ thì NÉM, không ghi record vô hình', () => {
    expect(() => dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', nhanLuc: luc, kho: 'XYZ' })).toThrow();
  });
});

describe('hai cột nuôi công thức Định danh', () => {
  const luc = new Date('2026-09-24T03:00:00Z');
  /* `Định danh` ghép Order Number final + Lineitem SKU final + Inventory type +
   * Unique code. Bỏ trống hai cột đầu thì nó ra `Retail-WH-34061` cụt ngủn —
   * đúng lỗi của record thử 24/09. Lark KHÔNG tự chép từ cột look up sang. */
  it('điền cả mã đơn lẫn SKU, nguyên văn', () => {
    const p = dungPayloadNhan({
      larkMonRecordId: 'rec1', maDon: '#MBLVD30542',
      sku: 'TomFried-TS2644-S-KPTT-PLA', nhanLuc: luc, kho: 'GVM',
    });
    expect(p['Order Number final']).toBe('#MBLVD30542');
    expect(p['Lineitem SKU final']).toBe('TomFried-TS2644-S-KPTT-PLA');
  });

  it('không tự thêm/bớt dấu # — giữ đúng thứ bảng liên kết đang có', () => {
    const p = dungPayloadNhan({
      larkMonRecordId: 'rec1', maDon: 'TA2337', sku: 'S', nhanLuc: luc, kho: 'GVM',
    });
    expect(p['Order Number final']).toBe('TA2337');
  });
});
