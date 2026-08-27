import { describe, expect, it } from 'vitest';
import { vnInvoiceToBill } from './vn-einvoice-bill';
import type { VnEInvoice } from './vn-einvoice';

const inv = (over: Partial<VnEInvoice> = {}): VnEInvoice => ({
  billNumber: '00007957', serial: '1K26TMB', issueDate: '2026-08-27', currency: 'VND',
  sellerName: 'CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ', sellerTaxCode: '0305141894',
  buyerName: 'CÔNG TY CỔ PHẦN INECSO', buyerTaxCode: '0109894073',
  amountExVat: 1310238, vatAmount: 104819, amountInclVat: 1415057,
  lines: [
    { trackingNumber: '35278967006', description: 'Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278967006', amountExVat: 605656, vatAmount: 48452, total: 654108 },
    { trackingNumber: '35278966995', description: 'Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278966995', amountExVat: 704582, vatAmount: 56367, total: 760949 },
  ],
  warnings: [],
  ...over,
});

describe('vnInvoiceToBill', () => {
  it('số hoá đơn giữ nguyên số 0 ở đầu để khớp khi tải lại cùng hoá đơn', () => {
    expect(vnInvoiceToBill(inv(), 'USD').billNumber).toBe('00007957');
  });

  it('tổng bill là số ĐÃ gồm thuế — khớp số phải trả trên hoá đơn', () => {
    expect(vnInvoiceToBill(inv(), 'USD').amount).toBe(1415057);
  });

  it('kỳ hoá đơn suy từ tháng ghi trong mô tả dòng hàng', () => {
    const b = vnInvoiceToBill(inv(), 'USD');
    expect(b.periodStart).toBe('2026-08-01');
    expect(b.periodEnd).toBe('2026-08-31');
  });

  // Tài khoản Aramex trong hệ thống để USD nhưng bên Việt Nam xuất hoá đơn VND.
  // Lấy theo tài khoản là ghi 42 triệu thành 42 triệu ĐÔ.
  it('tiền tệ lấy theo HOÁ ĐƠN, không lấy theo tài khoản', () => {
    expect(vnInvoiceToBill(inv(), 'USD').currency).toBe('VND');
  });

  // Aramex: bảng giá tính bằng USD nhưng đồng hiển thị là VND, nên hoá đơn VND
  // là ĐÚNG — báo động ở đây chỉ tạo nhiễu cho người nhập.
  it('hoá đơn trùng đồng HIỂN THỊ của tài khoản thì không báo động', () => {
    expect(vnInvoiceToBill(inv(), 'USD', 'VND').warnings.join(' ')).not.toMatch(/⚠|khác|kiểm tra lại/i);
  });

  it('hoá đơn lệch cả đồng chi phí lẫn đồng hiển thị thì cảnh báo', () => {
    const w = vnInvoiceToBill(inv({ currency: 'EUR', }), 'USD', 'VND').warnings.join(' ');
    expect(w).toMatch(/EUR/);
  });

  it('không truyền đồng hiển thị thì so với đồng tài khoản như cũ', () => {
    expect(vnInvoiceToBill(inv(), 'USD').warnings.join(' ')).toMatch(/VND.*USD|USD.*VND/);
    expect(vnInvoiceToBill(inv(), 'VND').warnings.join(' ')).not.toMatch(/tài khoản/i);
  });

  it('mỗi vận đơn thành một dòng bill, tiền chưa thuế vào cước gốc', () => {
    const b = vnInvoiceToBill(inv(), 'VND');
    expect(b.lines).toHaveLength(2);
    expect(b.lines[0]).toMatchObject({
      trackingNumber: '35278967006', base: 605656, vat: 48452, total: 654108,
    });
  });

  // Hoá đơn tài chính không tách phụ phí. Để 0 sẽ bị đọc nhầm là "carrier
  // không thu phụ phí", nên phải để trống.
  it('không bịa phụ phí: fuel và các khoản khác để trống', () => {
    const l = vnInvoiceToBill(inv(), 'VND').lines[0];
    expect(l.fuel).toBeNull();
    expect(l.other).toBeNull();
    expect(l.weightKg).toBeNull();
  });

  it('mỗi dòng ghi rõ nguồn là hoá đơn tài chính, không có chi tiết phụ phí', () => {
    expect(vnInvoiceToBill(inv(), 'VND').lines[0].note).toMatch(/không tách phụ phí/i);
  });

  it('bỏ qua dòng không phải cước vận đơn nhưng vẫn cảnh báo', () => {
    const b = vnInvoiceToBill(inv({
      lines: [
        { trackingNumber: null, description: 'Phí dịch vụ tháng 08/2026', amountExVat: 100000, vatAmount: 8000, total: 108000 },
        { trackingNumber: '35278967006', description: 'số vận đơn 35278967006', amountExVat: 605656, vatAmount: 48452, total: 654108 },
      ],
    }), 'VND');
    expect(b.lines).toHaveLength(1);
    expect(b.warnings.join(' ')).toMatch(/1 dòng không có số vận đơn/i);
  });

  it('giữ lại cảnh báo sẵn có của hoá đơn', () => {
    const b = vnInvoiceToBill(inv({ warnings: ['Bản PDF không in thuế từng dòng'] }), 'VND');
    expect(b.warnings.join(' ')).toMatch(/Bản PDF không in thuế/);
  });

  it('ghi người bán và mã số thuế vào ghi chú bill để đối chiếu pháp nhân', () => {
    expect(vnInvoiceToBill(inv(), 'VND').note).toContain('0305141894');
    expect(vnInvoiceToBill(inv(), 'VND').note).toContain('1K26TMB');
  });

  it('thuế từng dòng bị thiếu (nguồn PDF) thì để trống, tổng dòng vẫn là tiền chưa thuế', () => {
    const b = vnInvoiceToBill(inv({
      lines: [{ trackingNumber: '35278967006', description: 'số vận đơn 35278967006', amountExVat: 605656, vatAmount: null, total: 605656 }],
    }), 'VND');
    expect(b.lines[0].vat).toBeNull();
    expect(b.lines[0].total).toBe(605656);
  });
});
