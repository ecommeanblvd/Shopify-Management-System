import { describe, it, expect } from 'vitest';
import { xuLyQuet, type MonDeQuet } from './quet';

const m = (dinhDanh: string, o: Partial<MonDeQuet> = {}): MonDeQuet =>
  ({ dinhDanh, sku: null, shopifyLineId: null, shopifyVariantId: null, daXuLy: false, ...o });

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
  it('mã vendor (số trần) → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('8938505974194', [])).toEqual({ loai: 'khong_hieu', raw: '8938505974194' });
  });
  it('SKU trần (chuỗi không tiền tố) → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('SKU-ABC-XL', [])).toEqual({ loai: 'khong_hieu', raw: 'SKU-ABC-XL' });
  });
  it('chuỗi chỉ toàn khoảng trắng → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('  ', [])).toEqual({ loai: 'khong_hieu', raw: '  ' });
  });
  it('quét mã kho cũ → không hiểu ở màn này (màn phiếu cũ mới dùng WH-)', () => {
    expect(xuLyQuet('WH-00009890', [])).toEqual({ loai: 'khong_hieu', raw: 'WH-00009890' });
  });

  describe('mua nhiều cái cùng biến thể — quét lại không được dính mãi vào món đầu', () => {
    it('hai món cùng biến thể, cả hai đều CHƯA xử lý → chọn món đầu tiên', () => {
      const ds = [
        m('dd1', { shopifyVariantId: '222', daXuLy: false }),
        m('dd2', { shopifyVariantId: '222', daXuLy: false }),
      ];
      expect(xuLyQuet('V:222', ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
    it('món đầu ĐÃ xử lý, món sau chưa → chọn món CHƯA xử lý (không dính mãi vào món đầu)', () => {
      const ds = [
        m('dd1', { shopifyVariantId: '222', daXuLy: true }),
        m('dd2', { shopifyVariantId: '222', daXuLy: false }),
      ];
      expect(xuLyQuet('V:222', ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
    });
    it('cả hai món ĐỀU đã xử lý → vẫn nhận ra món (khớp đầu tiên), không báo "không hiểu"', () => {
      const ds = [
        m('dd1', { shopifyVariantId: '222', daXuLy: true }),
        m('dd2', { shopifyVariantId: '222', daXuLy: true }),
      ];
      expect(xuLyQuet('V:222', ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
  });
});
