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

  it('đủ bốn cột, không thừa cột nào', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', nhanLuc: luc });
    expect(Object.keys(p).sort()).toEqual([
      'Import (select order)', 'Import - Inventory type',
      'Ngày Import - tiếp nhận đồ tại kho', 'WH - Action',
    ]);
  });

  it('cột liên kết nhận MẢNG record_id, không phải chuỗi', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', nhanLuc: luc });
    expect(p['Import (select order)']).toEqual(['recABC']);
  });

  it('ngày ghi bằng mốc thời gian epoch, đúng kiểu date của Lark', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', nhanLuc: luc });
    expect(p['Ngày Import - tiếp nhận đồ tại kho']).toBe(luc.getTime());
  });

  it('lúc NHẬN là "Chờ QC", KHÔNG phải "Tạm nhập" — hàng chưa kiểm thì chưa nhập kho', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', nhanLuc: luc });
    expect(p['WH - Action']).toBe(' Chờ QC ');
  });

  it('KHÔNG điền tay các cột Lark tự lookup (SKU, mã đơn, brand)', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', nhanLuc: luc });
    for (const k of ['Lineitem SKU final', 'Order Number', 'Brand']) {
      expect(p).not.toHaveProperty(k);
    }
  });
});

describe('dungPayloadSauQcDat', () => {
  it('chỉ đổi ĐÚNG một cột, không đụng ngày hay liên kết', () => {
    expect(dungPayloadSauQcDat()).toEqual({ 'WH - Action': 'Tạm nhập (đi đơn)' });
  });
});
