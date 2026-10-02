import { describe, it, expect } from 'vitest';
import { dinhDangGiaTri, maNuoc, ngay, phanTram, tenTuNote, tien } from './trinh-bay';

describe('tenTuNote — chốt chặn chữ nội bộ', () => {
  /* Mọi ca dưới đây là `note` THẬT trong `carrier_surcharges` ngày 02/10/2026. Trang này gửi
     cho brand, nên đây là test quan trọng nhất của tệp: hụt một ca là lộ chuyện nội bộ. */
  it('cắt được tên sạch ở phần trước dấu gạch dài', () => {
    expect(tenTuNote('Sai địa chỉ (Bad address) — giá gốc, engine tự cộng phụ phí xăng dầu và VAT'))
      .toBe('Sai địa chỉ (Bad address)');
    expect(tenTuNote('FedEx ODA Tier B — max(550,000 VND/shipment, 9,200 VND/kg) — 2026'))
      .toBe('FedEx ODA Tier B');
    expect(tenTuNote('Phí hải quan đầu xuất')).toBe('Phí hải quan đầu xuất');
  });

  it('chặn mã kiện của brand khác', () => {
    expect(tenTuNote('#MBLVD29935 RO bị tính đầu tiên')).toBeNull();
  });

  it('chặn tỉ lệ khảo hoá đơn và ngày CEO duyệt, kể cả khi nằm ngay đầu chuỗi', () => {
    expect(tenTuNote('hoá đơn thật US 95%, GB 88%')).toBeNull();
    expect(tenTuNote('CEO duyệt 10/09/2026')).toBeNull();
    expect(tenTuNote('backfill PDF FedEx 2026-06-18')).toBeNull();
  });

  it('chữ nội bộ nằm SAU dấu gạch thì bị phép cắt bỏ trước, tên đầu vẫn ra', () => {
    expect(tenTuNote('Direct Signature — always từ 03/06/2026 | 03/09: hoá đơn thật US 95%'))
      .toBe('Direct Signature');
    expect(tenTuNote('Phí xử lý hàng nhập khối EU (EU import handling) — kiện đầu #MBLVD29935 RO. CEO duyệt 10/09/2026.'))
      .toBe('Phí xử lý hàng nhập khối EU (EU import handling)');
  });

  it('note trống hoặc dài quá → null, rơi về nhãn chung chứ không hiện một đoạn văn', () => {
    expect(tenTuNote(null)).toBeNull();
    expect(tenTuNote('   ')).toBeNull();
    expect(tenTuNote('x'.repeat(61))).toBeNull();
    expect(tenTuNote('x'.repeat(60))).toBe('x'.repeat(60));
  });
});

describe('tien — đơn vị theo tài khoản hãng', () => {
  /* Aramex HN có cost_currency='USD', DHL/FedEx/UPS/SF là VND. Viết cứng "đ" là hiện 35đ cho
     khoản 35 USD — sai gần 26.000 lần mà con số vẫn trông hợp lý. */
  it('VND làm tròn và dùng ký hiệu đ', () => {
    expect(tien(82_200, 'VND')).toBe('82.200đ');
    expect(tien(0.4, 'VND')).toBe('0đ');
  });
  it('tiền khác giữ hai số thập phân và ghi rõ mã tiền', () => {
    expect(tien(35, 'USD')).toBe('35,00 USD');
    expect(tien(0.4, 'USD')).toBe('0,40 USD');
  });
});

describe('dinhDangGiaTri', () => {
  it('phần trăm', () => {
    expect(dinhDangGiaTri('fuel_percent', 53.25, null, null, 'VND')).toBe('53,25%');
    expect(dinhDangGiaTri('vat_percent', 8, null, null, 'VND')).toBe('8,00%');
  });
  it('theo kg', () => {
    expect(dinhDangGiaTri('demand_per_kg', 28_400, null, null, 'VND')).toBe('28.400đ/kg');
  });
  it('theo bậc cân', () => {
    expect(dinhDangGiaTri('per_step_fixed', 1_900, null, 0.5, 'VND')).toBe('1.900đ mỗi 0.5kg');
  });
  /* FedEx ODA Tier B thu max(550.000đ/lô, 9.200đ/kg). Hiện một con số là brand tự suy ra sai
     nửa số ca — phải nói ra là lấy mức cao hơn. */
  it('hai vế lấy mức cao hơn thì nói rõ cả hai', () => {
    expect(dinhDangGiaTri('remote_fixed', 550_000, 9_200, null, 'VND'))
      .toBe('550.000đ/đơn hoặc 9.200đ/kg — lấy mức cao hơn');
  });
  it('value_per_kg bằng 0 không phải là vế thứ hai', () => {
    expect(dinhDangGiaTri('remote_fixed', 82_200, 0, null, 'VND')).toBe('82.200đ/đơn');
  });
});

describe('ngay', () => {
  /* `String(date).slice(0,10)` cho ra "Mon Sep 2" — bản đầu dùng nó nên LỌC SẠCH mọi tuần dầu
     mà trang vẫn dựng được. `toISOString()` thì lệch một ngày vì quy sang UTC. */
  it('Date → YYYY-MM-DD theo giờ treo tường, không lệch ngày', () => {
    expect(ngay(new Date(2026, 8, 21))).toBe('2026-09-21');
    expect(ngay(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(ngay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
  it('chuỗi thì cắt mười ký tự đầu', () => {
    expect(ngay('2026-07-01 00:00:00')).toBe('2026-07-01');
  });
  it('null và undefined → null', () => {
    expect(ngay(null)).toBeNull();
    expect(ngay(undefined)).toBeNull();
  });
});

describe('maNuoc', () => {
  it('sắp, in hoa, bỏ trùng', () => {
    expect(maNuoc(['us', 'DE', 'us'])).toEqual(['DE', 'US']);
  });
  it('mảng rỗng và thứ không phải mảng → null (jsonb nên không tin kiểu sẵn)', () => {
    expect(maNuoc([])).toBeNull();
    expect(maNuoc(null)).toBeNull();
    expect(maNuoc('US')).toBeNull();
    expect(maNuoc({ a: 1 })).toBeNull();
  });
  it('phần tử không phải mã ISO-2 thì bỏ', () => {
    expect(maNuoc(['US', 'USA', 3, null, 'de'])).toEqual(['DE', 'US']);
  });
});

describe('phanTram', () => {
  it('luôn hai số thập phân', () => {
    expect(phanTram(30)).toBe('30,00%');
    expect(phanTram(52.5)).toBe('52,50%');
  });
});
