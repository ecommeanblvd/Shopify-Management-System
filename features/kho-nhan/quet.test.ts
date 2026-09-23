import { describe, it, expect } from 'vitest';
import { xuLyQuet, type MonDeQuet } from './quet';
import { maTemChoMon } from './noi-mon-dong-don';

/**
 * Id phía DỮ LIỆU phải là GID ĐẦY ĐỦ, y như DB lưu — đo 23/09/2026:
 * `lark_mon_don.shopify_line_id` 6225/6225 là gid, 0 số trần; `shopify_order_lines` cũng vậy.
 * Bộ test cũ dùng '111'/'222' cả hai phía nên TỰ NHẤT QUÁN và không chứng minh được gì: nó để
 * lọt đúng cái bug làm cả luồng quét không dùng được (review cuối 23/09/2026 Critical 1). Tem
 * thì chỉ mang SỐ TRẦN, nên mọi test ở đây đặt gid một bên và số trần bên kia.
 */
const LINE_GID = 'gid://shopify/LineItem/14593977155752';
const LINE_SO = '14593977155752';
const LINE_GID_2 = 'gid://shopify/LineItem/17999132033319';
const LINE_SO_2 = '17999132033319';
const VAR_GID = 'gid://shopify/ProductVariant/45163940544678';
const VAR_SO = '45163940544678';

const m = (dinhDanh: string, o: Partial<MonDeQuet> = {}): MonDeQuet =>
  ({ dinhDanh, sku: null, shopifyLineId: null, shopifyVariantId: null, daXuLy: false, ...o });

describe('xuLyQuet', () => {
  it('quét mã đơn → mở đơn', () => {
    expect(xuLyQuet('O:999', [])).toEqual({ loai: 'mo_don', shopifyOrderId: '999' });
  });

  it('TEM DO CHÍNH HỆ IN RA, dán lên món của đơn ĐANG MỞ → chọn đúng món đó', () => {
    // Đi trọn vòng: in tem từ id gid trong DB rồi quét lại chính chuỗi ấy.
    const maTem = maTemChoMon({ shopifyLineId: LINE_GID });
    expect(maTem).toBe(`L:${LINE_SO}`);
    const ds = [m('dd1', { shopifyLineId: LINE_GID_2 }), m('dd2', { shopifyLineId: LINE_GID })];
    expect(xuLyQuet(maTem!, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });

  it('quét tem món của đơn ĐANG MỞ (id trong DB là gid) → chọn đúng món', () => {
    const ds = [m('dd1', { shopifyLineId: LINE_GID }), m('dd2', { shopifyLineId: LINE_GID_2 })];
    expect(xuLyQuet(`L:${LINE_SO_2}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });

  it('quét tem món KHÔNG thuộc đơn đang mở → báo đơn khác, không tự nhảy', () => {
    expect(xuLyQuet('L:999', [m('dd1', { shopifyLineId: LINE_GID })]))
      .toEqual({ loai: 'don_khac', shopifyOrderId: '' });
  });

  it('id trong DB là số trần (dữ liệu cũ/demo) vẫn khớp — rút số không phá dạng đã đúng', () => {
    expect(xuLyQuet(`L:${LINE_SO}`, [m('dd1', { shopifyLineId: LINE_SO })]))
      .toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });

  it('gid khác loại tài nguyên nhưng trùng số → KHÔNG được nhận nhầm là dòng đơn', () => {
    // Tem tự khai loại: 'L:gid://shopify/ProductVariant/…' là mã tự mâu thuẫn → không hiểu.
    expect(xuLyQuet(`L:${VAR_GID}`, [m('dd1', { shopifyLineId: LINE_GID })]))
      .toEqual({ loai: 'khong_hieu', raw: `L:${VAR_GID}` });
  });

  it('quét mã hàng khi đang mở đơn (variant trong DB là gid) → chọn món khớp', () => {
    expect(xuLyQuet(`V:${VAR_SO}`, [m('dd1', { shopifyVariantId: VAR_GID })]))
      .toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });

  it('quét mã hàng khi chưa mở đơn → đi tìm đơn đang chờ', () => {
    expect(xuLyQuet(`V:${VAR_SO}`, [])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: VAR_SO });
  });

  it('món không có id nào (chưa nối được) → không khớp bừa vào tem nào', () => {
    expect(xuLyQuet(`L:${LINE_SO}`, [m('dd1')])).toEqual({ loai: 'don_khac', shopifyOrderId: '' });
    expect(xuLyQuet(`V:${VAR_SO}`, [m('dd1')])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: VAR_SO });
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
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: false }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: false }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
    it('món đầu ĐÃ xử lý, món sau chưa → chọn món CHƯA xử lý (không dính mãi vào món đầu)', () => {
      const ds = [
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: true }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: false }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
    });
    it('cả hai món ĐỀU đã xử lý → vẫn nhận ra món (khớp đầu tiên), không báo "không hiểu"', () => {
      const ds = [
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: true }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: true }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
    it('hai món cùng biến thể nhưng KHÁC dòng đơn → tem L: chọn đúng dòng, không nhầm sang cái kia', () => {
      const ds = [
        m('dd1', { shopifyLineId: LINE_GID, shopifyVariantId: VAR_GID }),
        m('dd2', { shopifyLineId: LINE_GID_2, shopifyVariantId: VAR_GID }),
      ];
      expect(xuLyQuet(`L:${LINE_SO_2}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
      expect(xuLyQuet(`L:${LINE_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
  });
});
