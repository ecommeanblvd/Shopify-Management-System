import { describe, it, expect } from 'vitest';
import { parseCreditNoteXml } from './credit-note-parse';

// Trích từ credit note FedEx thật (TT78). 2 dòng AWB, số tiền GỒM VAT (âm).
const FEDEX_CN = `<HDon><DLHDon Id="DuLieuKy"><TTChung><THDon>Hóa đơn GTGT</THDon><KHHDon>K26TFA</KHHDon><SHDon>27612</SHDon><NLap>2026-06-05</NLap></TTChung><NDHDon><DSHHDVu>` +
  `<HHDVu><STT>1</STT><THHDVu>871785641570 VN CA</THHDVu><SLuong>-1</SLuong><ThTien>-2376108</ThTien><TTKhac><TTin><TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-2566197</DLieu></TTin><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>-190089</DLieu></TTin></TTKhac></HHDVu>` +
  `<HHDVu><STT>2</STT><THHDVu>871510877160 VN GB</THHDVu><SLuong>-1</SLuong><ThTien>-2481149</ThTien><TTKhac><TTin><TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-2679641</DLieu></TTin><TTin><TTruong>VATAmount</TTruong><KDLieu>numeric</KDLieu><DLieu>-198492</DLieu></TTin></TTKhac></HHDVu>` +
  `</DSHHDVu><TToan><TgTTTBSo>-5245838</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;

describe('parseCreditNoteXml', () => {
  it('FedEx TT78 → số CN (KHHDon-SHDon) + 2 dòng {tracking, creditVnd gồm VAT, dương}', () => {
    const r = parseCreditNoteXml(FEDEX_CN);
    expect(r.creditNoteNumber).toBe('K26TFA-27612');
    expect(r.lines).toEqual([
      { tracking: '871785641570', creditVnd: 2566197 },
      { tracking: '871510877160', creditVnd: 2679641 },
    ]);
  });
  it('fallback ThTien khi không có extra Amount', () => {
    const x = `<HDon><DLHDon><TTChung><KHHDon>X</KHHDon><SHDon>9</SHDon></TTChung><NDHDon><DSHHDVu>` +
      `<HHDVu><THHDVu>999000111222 VN US</THHDVu><ThTien>-100000</ThTien></HHDVu>` +
      `</DSHHDVu></NDHDon></DLHDon></HDon>`;
    expect(parseCreditNoteXml(x).lines).toEqual([{ tracking: '999000111222', creditVnd: 100000 }]);
  });
  it('chịu khoảng trắng trong <TTruong> Amount </TTruong> (NCC khác) → vẫn lấy incl-VAT, KHÔNG fallback ThTien', () => {
    const x = `<HDon><DLHDon><TTChung><KHHDon>Y</KHHDon><SHDon>5</SHDon></TTChung><NDHDon><DSHHDVu>` +
      `<HHDVu><THHDVu>123456789012 VN US</THHDVu><ThTien>-100000</ThTien><TTKhac><TTin><TTruong> Amount </TTruong><KDLieu>numeric</KDLieu><DLieu>-108000</DLieu></TTin></TTKhac></HHDVu>` +
      `</DSHHDVu></NDHDon></DLHDon></HDon>`;
    expect(parseCreditNoteXml(x).lines).toEqual([{ tracking: '123456789012', creditVnd: 108000 }]);
  });
  it('chịu thuộc tính trên tag (vd <HHDVu Id="..."> ở hoá đơn ký số) → vẫn parse', () => {
    const x = `<HDon><DLHDon Id="DuLieuKy"><TTChung><KHHDon foo="1">Z</KHHDon><SHDon>3</SHDon></TTChung><NDHDon><DSHHDVu>` +
      `<HHDVu Id="line-1"><THHDVu>555000111222 VN US</THHDVu><ThTien>-50000</ThTien><TTKhac><TTin><TTruong>Amount</TTruong><KDLieu>numeric</KDLieu><DLieu>-54000</DLieu></TTin></TTKhac></HHDVu>` +
      `</DSHHDVu></NDHDon></DLHDon></HDon>`;
    const r = parseCreditNoteXml(x);
    expect(r.creditNoteNumber).toBe('Z-3');
    expect(r.lines).toEqual([{ tracking: '555000111222', creditVnd: 54000 }]);
  });
  it('rác / không phải XML → rỗng', () => {
    expect(parseCreditNoteXml('blah')).toEqual({ creditNoteNumber: null, lines: [] });
  });
});

describe('XML nhiều dòng — nguồn để lấp "Kiện liên quan" (CEO 28/09/2026)', () => {
  /* Cột `noi_dung` chỉ lưu thẻ THHDVu ĐẦU TIÊN nên chứng từ nhiều kiện mất hết
     các dòng sau. Bộ đọc này lấy ĐỦ, và luồng nhập giờ dùng nó khi không có CSV. */
  const khoi = (desc: string, tien: number) =>
    `<HHDVu><THHDVu>${desc}</THHDVu><ThTien>${tien}</ThTien></HHDVu>`;
  const xml = `<HDon><KHHDon>1K26TFA</KHHDon><SHDon>45602</SHDon>`
    + khoi('876291039886 VN SA', -4002767)
    + khoi('875281985908 VN SA', -11268313)
    + `</HDon>`;

  it('bóc ĐỦ mọi kiện, không chỉ kiện đầu', () => {
    const r = parseCreditNoteXml(xml);
    expect(r.creditNoteNumber).toBe('1K26TFA-45602');
    expect(r.lines.map((l) => l.tracking)).toEqual(['876291039886', '875281985908']);
    expect(r.lines.map((l) => l.creditVnd)).toEqual([4002767, 11268313]);
  });

  it('dòng mô tả KHÔNG bắt đầu bằng số (kiểu DHL) → bỏ qua, không bịa mã', () => {
    const dhl = `<HDon><KHHDon>1K26THA</KHHDon><SHDon>463</SHDon>`
      + khoi('Cước phí sử dụng dịch vụ DHL. Số tài khoản: 527888723', -3453840)
      + `</HDon>`;
    expect(parseCreditNoteXml(dhl).lines).toEqual([]);
  });
});
