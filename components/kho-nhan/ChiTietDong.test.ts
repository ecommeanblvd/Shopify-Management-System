import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChiTietDong, KhungXemAnh, NoiDungChiTiet } from './ChiTietDong';
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

  /* CEO 03/10/2026: "PDF cũng xem tại chỗ luôn" — nên PDF cũng là nút, không phải liên kết. */
  it('PDF cũng là nút mở tại chỗ', () => {
    expect(/<a[^>]*anh-lark\/loi2/.test(html)).toBe(false);
    expect(html).toContain('aria-label="Xem to bb.pdf"');
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

describe('KhungXemAnh', () => {
  const ve = (ds: typeof d.anhLoiQc, i = 0) =>
    renderToStaticMarkup(createElement(KhungXemAnh, { ds, i, onDoi: () => {}, onDong: () => {} }));

  it('ảnh vẽ bằng thẻ img, kéo bản GỐC chứ không phải bản thu nhỏ', () => {
    const html = ve([{ token: 'a1', ten: 'a.jpg' }]);
    expect(html).toContain('<img src="/api/kho-nhan/anh-lark/a1"');
    expect(html).not.toContain('?w=');
  });

  /* PDF nhúng bằng iframe để dùng trình đọc sẵn có; route đặt Content-Disposition: inline. */
  it('PDF nhúng bằng iframe, kèm đường lùi mở tab mới', () => {
    const html = ve([{ token: 'p1', ten: 'bb.pdf' }]);
    expect(html).toContain('<iframe src="/api/kho-nhan/anh-lark/p1"');
    expect(html).toContain('Mở ở tab mới');
  });

  it('ảnh thì KHÔNG bày đường mở tab mới', () => {
    expect(ve([{ token: 'a1', ten: 'a.jpg' }])).not.toContain('Mở ở tab mới');
  });

  /* Một tệp thì không có gì để lật — bày mũi tên là mời người ta bấm vào chỗ không làm gì. */
  it('một tệp thì không có mũi tên lật và không đếm', () => {
    const html = ve([{ token: 'a1', ten: 'a.jpg' }]);
    expect(html).not.toContain('Ảnh trước');
    expect(html).not.toContain('1/1');
  });

  it('nhiều tệp thì có mũi tên và số đếm đúng vị trí đang xem', () => {
    const html = ve([{ token: 'a1', ten: 'a.jpg' }, { token: 'a2', ten: 'b.jpg' }], 1);
    expect(html).toContain('Ảnh trước');
    expect(html).toContain('2/2');
  });

  it('chỉ số lạc ra ngoài danh sách thì không vẽ gì, không nổ', () => {
    expect(ve([{ token: 'a1', ten: 'a.jpg' }], 5)).toBe('');
  });
});
