import { describe, it, expect } from 'vitest';
import { docSurgeUpsPdf, ngayTiengAnh } from './ups';

/**
 * Trích từ tờ Surge Emergency Fee THẬT của UPS (bản cập nhật 18/09/2026, CEO gửi
 * 12/10/2026) — giữ nguyên cách text tuôn ra khỏi PDF, kể cả chỗ TRỘN CỘT:
 *   - tên tuyến bị cắt làm hai dòng ("Australia, New Zealand," / "India, or Rest of Asia")
 *     nên chữ "Rest of Asia" rơi xuống SAU số tiền;
 *   - bảng "Other Charges" in 4 cột theo cửa sổ ngày, chữ "through" gom hết sang một dòng
 *     khác nên không ghép cặp ngày được.
 * Hai chỗ đó chính là lý do bộ đọc không cố dựng lại bảng.
 */
const PDF = `                                   Surge Emergency Fee


Surge Emergency Fee1 update as of September 18, 2026

   Origin     Destination                        Service                         Other         5/31/26        9/27/26       11/22/26       12/27/26
 Country or                                                                     Charges        through       through        through        through
  Territory                                                                                    9/26/26       11/21/26       12/26/26        1/16/27

   United        To All      UPS Worldwide Express®, UPS Worldwide Express      Additional    $8.75 USD    $8.75 USD per   $11.90 USD    $8.75 USD per
   States     Destinations       Saver®, UPS Worldwide Expedited®               Handling2    per package      package      per package      package

 Origin Country or          Destination                                 Service                             Surge Emergency      Effective Dates
Australia, New Zealand,     United States       UPS Worldwide Express®, UPS Worldwide Express Saver®, UPS      $0.77 per lb.     Effective September 27, 2026. Surge
 India, or Rest of Asia                          Worldwide Express Plus®, UPS Worldwide Expedited®                               Emergency Fee will remain in effect
                                                                                                                                          until further notice.
   Europe or ISMEA          United States       UPS Worldwide Express®, UPS Worldwide Express Saver®, UPS      $0.29 per lb.     Effective September 27, 2026. Surge
    United States          All Destinations     UPS Worldwide Economy DDP®                                     $0.50 per lb.     Effective September 27, 2026. Surge

          Region                                                                   Countries Included in Each Region
       Rest of Asia         American Samoa, Brunei, Indonesia, Japan, Thailand, Taiwan, Vietnam, Samoa.
`;

describe('ngayTiengAnh', () => {
  it('đọc ngày kiểu Mỹ', () => {
    expect(ngayTiengAnh('September 27, 2026')).toBe('2026-09-27');
    expect(ngayTiengAnh(' March 2, 2026 ')).toBe('2026-03-02');
  });
  it('dạng lạ → null, không đoán', () => {
    expect(ngayTiengAnh('27/09/2026')).toBeNull();
    expect(ngayTiengAnh('Septembre 27, 2026')).toBeNull();
  });
});

describe('docSurgeUpsPdf', () => {
  it('đọc ngày cập nhật của tờ tài liệu', () => {
    expect(docSurgeUpsPdf(PDF)!.capNhatNgay).toBe('2026-09-18');
  });
  it('bắt các khoản $/lb kèm ngày hiệu lực', () => {
    const r = docSurgeUpsPdf(PDF)!;
    const theoLb = r.khoan.filter((k) => k.donVi === 'lb');
    expect(theoLb.map((k) => k.tien)).toEqual([0.77, 0.29, 0.5]);
    expect(theoLb.every((k) => k.hieuLucTu === '2026-09-27')).toBe(true);
  });
  /* Dòng $0,77/lb "Australia, New Zealand, India, or Rest of Asia → United States" là dòng
   * DUY NHẤT của tờ này chạm tuyến Việt Nam (Việt Nam nằm trong vùng "Rest of Asia" do chính
   * UPS liệt kê). Phải nhận ra nó dù chữ "Rest of Asia" rơi xuống SAU số tiền. */
  it('trỏ được vào dòng chạm tuyến VN dù "Rest of Asia" rơi SAU số tiền', () => {
    const r = docSurgeUpsPdf(PDF)!;
    expect(r.khoanLienQuanVn.map((k) => k.tien)).toContain(0.77);
    expect(r.khoanLienQuanVn.find((k) => k.tien === 0.77)!.hieuLucTu).toBe('2026-09-27');
  });
  /* Bảng giải thích vùng ở cuối tờ cũng có chữ "Rest of Asia … Vietnam". Nếu bối cảnh quét
   * tới đó thì MỌI khoản đều bị gắn nhãn "chạm tuyến VN" và gợi ý thành vô dụng. */
  it('không gắn nhãn VN cho mọi khoản chỉ vì bảng giải thích vùng ở cuối tờ', () => {
    const r = docSurgeUpsPdf(PDF)!;
    expect(r.khoanLienQuanVn.length).toBeLessThan(r.khoan.length);
  });
  it('không phải tờ surge → null (≠ "UPS bỏ phí surge")', () => {
    expect(docSurgeUpsPdf('')).toBeNull();
    expect(docSurgeUpsPdf('Fuel Surcharge history 39.00%')).toBeNull();
  });
});

describe('docSurgeUpsPdf — dấu vết', () => {
  const dv = (t: string) => docSurgeUpsPdf(t)!.dauVet;
  it('đổi MỨC tiền → dấu vết đổi', () => {
    expect(dv(PDF.replace('$0.77 per lb.', '$0.95 per lb.'))).not.toBe(dv(PDF));
  });
  it('đổi NGÀY HIỆU LỰC → dấu vết đổi (chỗ CEO lưu ý)', () => {
    expect(dv(PDF.replace('Effective September 27, 2026', 'Effective October 11, 2026'))).not.toBe(dv(PDF));
  });
  it('đổi CỬA SỔ NGÀY của bảng Other Charges → dấu vết đổi', () => {
    expect(dv(PDF.replace('9/26/26', '9/20/26'))).not.toBe(dv(PDF));
  });
  it('đổi mức trong bảng Other Charges → dấu vết đổi, dù bộ đọc không dựng được dòng', () => {
    expect(dv(PDF.replace('$11.90 USD', '$12.50 USD'))).not.toBe(dv(PDF));
  });
  it('chỉ đổi LỀ TRANG / khoảng trắng → dấu vết GIỮ NGUYÊN (không báo động hú hoạ)', () => {
    expect(dv(PDF.replace(/ {2,}/g, '   ').replace(/\n/g, '\n '))).toBe(dv(PDF));
  });
  it('đổi thứ tự dòng → dấu vết giữ nguyên (sắp xếp trước khi băm)', () => {
    const doi = PDF.replace('$0.29 per lb.', '§TMP§').replace('$0.50 per lb.', '$0.29 per lb.').replace('§TMP§', '$0.50 per lb.');
    expect(dv(doi)).toBe(dv(PDF));
  });
});
