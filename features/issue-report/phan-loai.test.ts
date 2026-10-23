import { describe, expect, it } from 'vitest';
import {
  DANH_SACH_MODULE, maBaoLoi, moduleHopLe, moduleTuDuongDan, mucDoHopLe, nhanModule, trangThaiHopLe,
} from './phan-loai';

describe('moduleTuDuongDan', () => {
  it('khớp module theo tiền tố, kể cả route con', () => {
    expect(moduleTuDuongDan('/f/ship-ho/partners/abc/contracts').ma).toBe('ship-ho');
    expect(moduleTuDuongDan('/f/orders').ma).toBe('orders');
    expect(moduleTuDuongDan('/f/carrier-rates/123/zones?x=1').ma).toBe('carrier-rates');
  });
  it('không nhầm tiền tố chỉ giống đầu chuỗi', () => {
    expect(moduleTuDuongDan('/f/orders-extra').ma).toBe('khac');
  });
  it('route phụ thuộc module cha gom về cùng module', () => {
    expect(moduleTuDuongDan('/f/lifecycle/stats').ma).toBe('fulfillment');
    expect(moduleTuDuongDan('/f/customer-account/hubs').ma).toBe('functions');
  });
  it('đường dẫn lạ → khác', () => {
    expect(moduleTuDuongDan('/').ma).toBe('khac');
  });
});

describe('giá trị hợp lệ', () => {
  it('mức độ và trạng thái', () => {
    expect(mucDoHopLe('cao')).toBe(true);
    expect(mucDoHopLe('x')).toBe(false);
    expect(trangThaiHopLe('can_nguoi')).toBe(true);
    expect(trangThaiHopLe('done')).toBe(false);
  });
  it('mã báo lỗi', () => {
    expect(maBaoLoi(12)).toBe('BL-12');
  });
});

describe('danh sách module cho ô chọn', () => {
  it('mỗi mã một lần, có Khác, và mọi module suy từ đường dẫn đều chọn được', () => {
    const ma = DANH_SACH_MODULE.map((m) => m.ma);
    expect(new Set(ma).size).toBe(ma.length);
    expect(ma).toContain('khac');
    for (const p of ['/f/orders', '/f/lifecycle', '/f/customer-account', '/admin/issues', '/']) {
      expect(moduleHopLe(moduleTuDuongDan(p).ma)).toBe(true);
    }
  });
  it('từ chối mã lạ, đọc được nhãn', () => {
    expect(moduleHopLe('khong-co')).toBe(false);
    expect(nhanModule('ship-ho')).toBe('Ship hộ');
  });
});
