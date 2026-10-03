import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChiTietDong, NoiDungChiTiet } from './ChiTietDong';
import type { DongSoNhap } from '@/features/kho-nhan/types';

const d: DongSoNhap = {
  recordId: 'r1', ngayImport: '2026-10-01', dinhDanh: '#MBLVD1-SKU-1-Retail-WH-1',
  warehouse: 'HN | GVM', inventoryType: 'Retail', orderNumber: '#MBLVD1', sku: 'SKU-1',
  lineitemName: 'Áo lụa - Đen / S', storeFinal: '#MBLVD', vendorFinal: 'Esmee',
  qcCheck: 'QC Failed', lyDoFail: 'xước chỉ ở vai, bẩn gấu áo — brand đã xác nhận',
  whAction: 'Lưu kho', uniqueCode: 'WH-34246', soLuong: 2,
  coAnhHangDen: true, coBbBanGiao: false,
  anhHangDen: [{ token: 'hang1', ten: 'hang.jpg' }],
  bbBanGiao: [], anhLoiQc: [{ token: 'loi1', ten: 'loi.jpg' }, { token: 'loi2', ten: 'bb.pdf' }],
  cuaHeThong: false,
};

/* Kết xuất NỘI DUNG, không phải lớp vỏ Radix: `Dialog` vẽ qua Portal nên SSR trả chuỗi rỗng. */
const ve = (x: DongSoNhap) => renderToStaticMarkup(createElement(NoiDungChiTiet, { dong: x }));

describe('ChiTietDong', () => {
  it('không có dòng nào thì hộp thoại không vẽ gì', () => {
    expect(renderToStaticMarkup(createElement(ChiTietDong, { dong: null, onDong: () => {} })))
      .toBe('');
  });

  const html = ve(d);

  /* Lý do lỗi là thứ cột hẹp cắt mất — modal tồn tại chính vì nó, nên phải hiện ĐỦ. */
  it('hiện lý do lỗi đầy đủ, không cắt', () => {
    expect(html).toContain('xước chỉ ở vai, bẩn gấu áo — brand đã xác nhận');
  });

  it('ảnh lỗi xem cỡ lớn, không phải ô 28px của bảng', () => {
    expect(html).toContain('/api/kho-nhan/anh-lark/loi1?w=320');
    expect(html).toContain('size-28');
  });

  /* CEO 03/10/2026: bấm ảnh KHÔNG được nhảy tab. Ảnh phải là nút mở khung xem tại chỗ. */
  it('ảnh là NÚT mở tại chỗ, không phải liên kết sang tab khác', () => {
    const anh = /<(button|a)[^>]*>\s*<img[^>]*anh-lark\/loi1/.exec(html);
    expect(anh?.[1]).toBe('button');
    expect(html).toContain('aria-label="Xem to loi.jpg"');
  });

  /* PDF thì ngược lại: trình duyệt có sẵn trình đọc, dựng lại một cái là việc khác hẳn. */
  it('PDF vẫn là liên kết mở tab mới', () => {
    expect(/<a[^>]*anh-lark\/loi2[^>]*target="_blank"/.test(html)).toBe(true);
  });

  it('PDF không vẽ thẻ ảnh hỏng', () => {
    expect(html).not.toContain('/api/kho-nhan/anh-lark/loi2?w=320');
    expect(html).toContain('PDF');
  });

  it('gộp đủ các nhóm ảnh đang có, bỏ nhóm rỗng', () => {
    expect(html).toContain('Ảnh chụp lỗi QC');
    expect(html).toContain('Ảnh thực tế sản phẩm');
    expect(html).not.toContain('Biên bản bàn giao');   // rỗng → không vẽ khối trống
  });

  it('nói rõ dòng này của Lark hay của hệ thống', () => {
    expect(html).toContain('Lark');
  });
});
