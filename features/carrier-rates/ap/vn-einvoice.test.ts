import { describe, expect, it } from 'vitest';
import { parseVnEInvoiceXml, parseVnEInvoicePdfText, trackingFromDescription, periodFromLines } from './vn-einvoice';

const XML = `<?xml version="1.0" encoding="utf-8"?><HDon><DLHDon Id="Z4FEIAM96G_X"><TTChung><PBan>2.1.0</PBan><THDon>Hóa đơn giá trị gia tăng</THDon><KHMSHDon>1</KHMSHDon><KHHDon>K26TMB</KHHDon><SHDon>00007957</SHDon><NLap>2026-08-27</NLap><DVTTe>VND</DVTTe><TGia>1.00</TGia></TTChung><NDHDon><NBan><Ten>CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ</Ten><MST>0305141894</MST></NBan><NMua><Ten>CÔNG TY CỔ PHẦN INECSO</Ten><MST>0109894073</MST></NMua><DSHHDVu>
<HHDVu><TChat>1</TChat><STT>1</STT><THHDVu>Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278967006</THHDVu><DVTinh>Lô</DVTinh><SLuong>1.000000</SLuong><DGia>605656.000000</DGia><ThTien>605656.000000</ThTien><TSuat>8%</TSuat><TTKhac><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>48452.000000</DLieu></TTin></TTKhac></HHDVu>
<HHDVu><TChat>1</TChat><STT>2</STT><THHDVu>Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278966995</THHDVu><DVTinh>Lô</DVTinh><SLuong>1.000000</SLuong><DGia>704582.000000</DGia><ThTien>704582.000000</ThTien><TSuat>8%</TSuat><TTKhac><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>56367.000000</DLieu></TTin></TTKhac></HHDVu>
</DSHHDVu><TToan><TgTCThue>1310238.000000</TgTCThue><TgTThue>104819.000000</TgTThue><TgTTTBSo>1415057.000000</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;

describe('parseVnEInvoiceXml', () => {
  it('đọc số hoá đơn, ký hiệu, ngày lập, đơn vị tiền', () => {
    const inv = parseVnEInvoiceXml(XML)!;
    expect(inv.billNumber).toBe('00007957');
    // Ký hiệu đầy đủ = mẫu số (KHMSHDon) + ký hiệu (KHHDon), khớp cách bản in ghi.
    expect(inv.serial).toBe('1K26TMB');
    expect(inv.issueDate).toBe('2026-08-27');
    expect(inv.currency).toBe('VND');
  });

  it('đọc người bán và người mua kèm mã số thuế', () => {
    const inv = parseVnEInvoiceXml(XML)!;
    expect(inv.sellerName).toContain('HỢP NHẤT QUỐC TẾ');
    expect(inv.sellerTaxCode).toBe('0305141894');
    expect(inv.buyerTaxCode).toBe('0109894073');
  });

  it('đọc tổng: chưa thuế, thuế, và tổng thanh toán', () => {
    const inv = parseVnEInvoiceXml(XML)!;
    expect(inv.amountExVat).toBe(1310238);
    expect(inv.vatAmount).toBe(104819);
    expect(inv.amountInclVat).toBe(1415057);
  });

  it('mỗi dòng hàng ra một vận đơn kèm tiền chưa thuế, thuế, tổng', () => {
    const inv = parseVnEInvoiceXml(XML)!;
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]).toMatchObject({
      trackingNumber: '35278967006', amountExVat: 605656, vatAmount: 48452, total: 654108,
    });
    expect(inv.lines[1].trackingNumber).toBe('35278966995');
  });

  it('tổng các dòng phải khớp tổng hoá đơn, lệch thì cảnh báo', () => {
    const inv = parseVnEInvoiceXml(XML)!;
    expect(inv.warnings).toEqual([]);
    const lech = XML.replace('<TgTCThue>1310238.000000</TgTCThue>', '<TgTCThue>9999999.000000</TgTCThue>');
    expect(parseVnEInvoiceXml(lech)!.warnings.join(' ')).toMatch(/lệch/i);
  });

  it('không phải hoá đơn điện tử Việt Nam thì trả null', () => {
    expect(parseVnEInvoiceXml('<Invoice><ID>123</ID></Invoice>')).toBeNull();
    expect(parseVnEInvoiceXml('')).toBeNull();
  });
});

describe('trackingFromDescription', () => {
  it('lấy số vận đơn trong mô tả tiếng Việt', () => {
    expect(trackingFromDescription('Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278967006')).toBe('35278967006');
  });

  it('chấp nhận chữ hoa, chữ thường và "vận đơn số"', () => {
    expect(trackingFromDescription('SỐ VẬN ĐƠN 12345678901')).toBe('12345678901');
    expect(trackingFromDescription('vận đơn số 12345678901')).toBe('12345678901');
  });

  it('bỏ qua chữ số của tháng/năm — chỉ lấy phần sau "vận đơn"', () => {
    expect(trackingFromDescription('Cước tháng 08/2026 số vận đơn 35278967006')).toBe('35278967006');
  });

  it('mô tả không có vận đơn thì trả null', () => {
    expect(trackingFromDescription('Phí dịch vụ tháng 08/2026')).toBeNull();
    expect(trackingFromDescription('')).toBeNull();
  });
});

describe('periodFromLines', () => {
  it('suy kỳ hoá đơn từ "tháng 08/2026" trong mô tả', () => {
    expect(periodFromLines(['Cước chuyển phát nhanh tháng 08/2026 số vận đơn 1'], '2026-08-27'))
      .toEqual({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  });

  it('tháng 2 năm nhuận ra đúng 29 ngày', () => {
    expect(periodFromLines(['Cước tháng 02/2028 số vận đơn 1'], '2028-03-01').periodEnd).toBe('2028-02-29');
  });

  it('không đọc được tháng thì lấy theo tháng của ngày lập', () => {
    expect(periodFromLines(['Phí dịch vụ'], '2026-08-27'))
      .toEqual({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  });
});

describe('parseVnEInvoicePdfText', () => {
  const PDF_TEXT = `
                              CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ
                              Mã số thuế (Tax code): 0 3 0 5 1 4 1 8 9 4
                                    HÓA ĐƠN GIÁ TRỊ GIA TĂNG                    Ký hiệu (Serial): 1K26TMB
                                              (VAT INVOICE)                     Số (No.):        00007957
                                   Ngày (Date) 27 tháng (month) 08 năm (year) 2026
Tên đơn vị (Company's name): CÔNG TY CỔ PHẦN INECSO
Mã số thuế (Tax code): 0 1 0 9 8 9 4 0 7 3
   1     Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278967006      Lô        1     605.656      605.656
   2     Cước chuyển phát nhanh tháng 08/2026 số vận đơn 35278966995      Lô        1     704.582      704.582
                              Cộng tiền hàng hóa, dịch vụ (Total amount excl. VAT):          1.310.238
      Thuế suất GTGT (VAT rate):     8%     Tiền thuế GTGT (VAT amount):                       104.819
                              Tổng tiền thanh toán (Total amount):                          1.415.057
`;

  it('đọc được số hoá đơn, ngày lập và mã số thuế dù chữ số bị tách bằng khoảng trắng', () => {
    const inv = parseVnEInvoicePdfText(PDF_TEXT)!;
    expect(inv.billNumber).toBe('00007957');
    expect(inv.issueDate).toBe('2026-08-27');
    expect(inv.sellerTaxCode).toBe('0305141894');
    expect(inv.buyerTaxCode).toBe('0109894073');
  });

  it('đọc đủ dòng vận đơn và số tiền theo định dạng dấu chấm', () => {
    const inv = parseVnEInvoicePdfText(PDF_TEXT)!;
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]).toMatchObject({ trackingNumber: '35278967006', amountExVat: 605656 });
    expect(inv.lines[1]).toMatchObject({ trackingNumber: '35278966995', amountExVat: 704582 });
  });

  it('đọc tổng cuối hoá đơn', () => {
    const inv = parseVnEInvoicePdfText(PDF_TEXT)!;
    expect(inv.amountExVat).toBe(1310238);
    expect(inv.vatAmount).toBe(104819);
    expect(inv.amountInclVat).toBe(1415057);
  });

  it('PDF không phải hoá đơn Việt Nam thì trả null', () => {
    expect(parseVnEInvoicePdfText('FedEx Invoice\nTotal Due 1,234.00 USD')).toBeNull();
  });

  // PDF không có VAT từng dòng — chỉ có tổng. Chia đều theo tỉ lệ sẽ tạo số
  // ảo, nên để null và cảnh báo, ai đọc bill cũng biết là thiếu.
  it('dòng từ PDF không có thuế riêng nên để trống và có cảnh báo', () => {
    const inv = parseVnEInvoicePdfText(PDF_TEXT)!;
    expect(inv.lines[0].vatAmount).toBeNull();
    expect(inv.warnings.join(' ')).toMatch(/thuế từng dòng/i);
  });
});
