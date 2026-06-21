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
