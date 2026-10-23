import { describe, expect, it } from 'vitest';
import {
  maBaoLoi, moduleTuDuongDan, mucDoHopLe, trangThaiHopLe,
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
