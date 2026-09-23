import { describe, it, expect } from 'vitest';
import { xuLyQuet, type MonDeQuet } from './quet';

const m = (dinhDanh: string, o: Partial<MonDeQuet> = {}): MonDeQuet =>
  ({ dinhDanh, sku: null, shopifyLineId: null, shopifyVariantId: null, ...o });

describe('xuLyQuet', () => {
  it('quét mã đơn → mở đơn', () => {
    expect(xuLyQuet('O:999', [])).toEqual({ loai: 'mo_don', shopifyOrderId: '999' });
  });
  it('quét tem món của đơn ĐANG MỞ → chọn đúng món', () => {
    const ds = [m('dd1', { shopifyLineId: '111' }), m('dd2', { shopifyLineId: '222' })];
    expect(xuLyQuet('L:222', ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });
  it('quét tem món KHÔNG thuộc đơn đang mở → báo đơn khác, không tự nhảy', () => {
    expect(xuLyQuet('L:999', [m('dd1', { shopifyLineId: '111' })]))
      .toEqual({ loai: 'don_khac', shopifyOrderId: '' });
  });
  it('quét mã hàng khi đang mở đơn → chọn món khớp', () => {
    expect(xuLyQuet('V:222', [m('dd1', { shopifyVariantId: '222' })])).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });
  it('quét mã hàng khi chưa mở đơn → đi tìm đơn đang chờ', () => {
    expect(xuLyQuet('V:222', [])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: '222' });
  });
  it('mã vendor / chuỗi trần / rỗng → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('8938505974194', [])).toEqual({ loai: 'khong_hieu', raw: '8938505974194' });
    expect(xuLyQuet('SKU-ABC-XL', [])).toEqual({ loai: 'khong_hieu', raw: 'SKU-ABC-XL' });
    expect(xuLyQuet('  ', [])).toEqual({ loai: 'khong_hieu', raw: '  ' });
  });
  it('quét mã kho cũ → không hiểu ở màn này (màn phiếu cũ mới dùng WH-)', () => {
    expect(xuLyQuet('WH-00009890', []).loai).toBe('khong_hieu');
  });
});
