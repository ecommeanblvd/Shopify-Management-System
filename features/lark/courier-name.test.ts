import { describe, it, expect } from 'vitest';
import { tenCourierLark, COURIER_KEYS_CO_MAP } from './courier-name';

describe('tenCourierLark', () => {
  it('map đúng tên Lark đang dùng', () => {
    expect(tenCourierLark('fedex')).toBe('FedEx');
    expect(tenCourierLark('dhl')).toBe('DHL');
    expect(tenCourierLark('aramex')).toBe('HNC Aramex');
    expect(tenCourierLark('ups')).toBe('UPS');
    expect(tenCourierLark('sf-express')).toBe('ShunFeng');
  });

  it('không phân biệt hoa thường và khoảng trắng', () => {
    expect(tenCourierLark(' FedEx ')).toBe('FedEx');
    expect(tenCourierLark('DHL')).toBe('DHL');
  });

  it('hãng lạ → null, KHÔNG đoán — ghi giá trị lạ vào cột chọn sẽ đẻ lựa chọn mới trên Lark', () => {
    expect(tenCourierLark('gls')).toBeNull();
    expect(tenCourierLark('')).toBeNull();
    expect(tenCourierLark(null)).toBeNull();
    expect(tenCourierLark(undefined)).toBeNull();
  });

  it('mọi hãng có map đều ra tên không rỗng', () => {
    for (const k of COURIER_KEYS_CO_MAP) expect(tenCourierLark(k)).toBeTruthy();
  });
});
