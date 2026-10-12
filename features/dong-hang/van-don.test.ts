import { describe, it, expect } from 'vitest';
import { chonZip, canhBaoDiaChi } from './van-don';

describe('chonZip', () => {
  it('ZIP+4 nối đúng mã khách → dán ZIP+4', () => {
    const r = chonZip({ shipPostcode: '32312', addrStandardized: 'TALLAHASSEE, FL, 32312-3934', addrIssue: null });
    expect(r).toMatchObject({ zip: '32312-3934', nguon: 'zip4' });
  });
  /* INTERPOLATED = hãng nội suy +4 từ dải số nhà quanh đó, KHÔNG tra được chính địa chỉ này
   * (155 đơn). Dán một +4 đoán tệ hơn dán ZIP 5 số đúng. */
  it('cờ nội suy → bỏ ZIP+4, dán mã khách', () => {
    const r = chonZip({ shipPostcode: '32312', addrStandardized: 'TALLAHASSEE, FL, 32312-3934', addrIssue: 'INTERPOLATED.STREET.ADDRESS' });
    expect(r).toMatchObject({ zip: '32312', nguon: 'khach' });
    expect(r.vi).toMatch(/nội suy/);
  });
  it('hãng không trả bản chuẩn hoá → dán mã khách', () => {
    expect(chonZip({ shipPostcode: '32312', addrStandardized: null, addrIssue: null }))
      .toMatchObject({ zip: '32312', nguon: 'khach' });
  });
  it('mã hãng trả KHÔNG nối tiếp mã khách → dán mã khách, không đổi bừa', () => {
    expect(chonZip({ shipPostcode: '32312', addrStandardized: 'MIAMI, FL, 33101-1234', addrIssue: null }))
      .toMatchObject({ zip: '32312', nguon: 'khach' });
  });
  it('mã hãng trả dài BẰNG mã khách (ca GB) → dán mã khách', () => {
    expect(chonZip({ shipPostcode: 'W9 1UJ', addrStandardized: 'LONDON, W9 1UJ', addrIssue: null }))
      .toMatchObject({ zip: 'W9 1UJ', nguon: 'khach' });
  });
  it('đơn không có mã bưu chính → null, nói rõ', () => {
    const r = chonZip({ shipPostcode: null, addrStandardized: 'DUBAI', addrIssue: null });
    expect(r.zip).toBeNull();
    expect(r.vi).toMatch(/không có mã bưu chính/);
  });
});

describe('canhBaoDiaChi', () => {
  /* Bốn cách viết đã gặp thật trên dữ liệu production, đều chứa chữ "suite". */
  it.each([
    'SuiteRequiredButMissing', 'InvalidSuiteNumber', 'SUITE.NUMBER.REQUIRED', 'INVALID.SUITE.NUMBER',
  ])('cờ %s → băng ĐỎ, bắt xác nhận', (co) => {
    const r = canhBaoDiaChi({ addrIssue: co });
    expect(r.muc).toBe('do');
    expect(r.batXacNhan).toBe(true);
    expect(r.cau).toMatch(/số căn hộ/);
  });
  it('cờ khác → băng vàng, không bắt xác nhận', () => {
    const r = canhBaoDiaChi({ addrIssue: 'STANDARDIZED.ADDRESS.NOTFOUND' });
    expect(r).toMatchObject({ muc: 'vang', batXacNhan: false });
    expect(r.cau).toContain('STANDARDIZED.ADDRESS.NOTFOUND');
  });
  it('không cờ → không băng', () => {
    expect(canhBaoDiaChi({ addrIssue: null })).toMatchObject({ muc: 'khong', cau: null, batXacNhan: false });
  });
});

import { nguonCanKien, moTaHangHoa } from './van-don';

const sms = { hop: 'A3', canKg: 2.4, dai: 40, rong: 30, cao: 20, luc: '2026-10-12T03:00:00.000Z' };
const lark = { hop: 'B1', canKg: 2.1, dai: 38, rong: 28, cao: 18 };

describe('nguonCanKien', () => {
  it('có bước Đóng thùng của SMS → lấy SMS (lần cân cuối)', () => {
    const r = nguonCanKien({ sms, lark });
    expect(r).toMatchObject({ canKg: 2.4, dai: 40, rong: 30, cao: 20, hop: 'A3', nguon: 'sms', thieu: [] });
    expect(r.nhan).toMatch(/Đóng thùng/);
  });
  it('chưa đóng thùng trong SMS → rơi về Lark, nói rõ nguồn', () => {
    const r = nguonCanKien({ sms: null, lark });
    expect(r).toMatchObject({ canKg: 2.1, hop: 'B1', nguon: 'lark', thieu: [] });
    expect(r.nhan).toMatch(/Lark/);
  });
  it('không có nguồn nào → thiếu cả cân và kích thước', () => {
    const r = nguonCanKien({ sms: null, lark: null });
    expect(r).toMatchObject({ canKg: null, nguon: null });
    expect(r.thieu).toEqual(['cân', 'kích thước']);
  });
  it('có cân nhưng THIẾU một chiều → vẫn tính là thiếu kích thước', () => {
    const r = nguonCanKien({ sms: null, lark: { ...lark, cao: null } });
    expect(r.thieu).toEqual(['kích thước']);
  });
  it('cân 0 không phải cân → tính là thiếu', () => {
    const r = nguonCanKien({ sms: null, lark: { ...lark, canKg: 0 } });
    expect(r.thieu).toEqual(['cân']);
  });
});

describe('moTaHangHoa', () => {
  it('có chất liệu → ghép tên — chất liệu', () => {
    expect(moTaHangHoa('Amy Dress', 'Silk')).toBe('Amy Dress — Silk');
  });
  it('thiếu chất liệu → chỉ tên, KHÔNG để dấu gạch lơ lửng', () => {
    expect(moTaHangHoa('Amy Dress', null)).toBe('Amy Dress');
    expect(moTaHangHoa('Amy Dress', '   ')).toBe('Amy Dress');
  });
});

import { dungKhoiVanDon, vanBanKhoi, type VaoKhoiVanDon } from './van-don';

const DIA_CHI = {
  shipName: 'Jane Doe', shipCompany: null,
  shipAddress1: '1395 Silver Moon Drive', shipAddress2: null,
  shipCity: 'Tallahassee', shipProvinceCode: 'US-FL',
  shipPostcode: '32312', shipCountry: 'US',
  addrIssue: null, addrStandardized: 'TALLAHASSEE, FL, 32312-3934',
  addrDeliverable: true, addrVerifiedAt: '2026-10-01T00:00:00.000Z',
};
const vao = (over: Partial<VaoKhoiVanDon> = {}): VaoKhoiVanDon => ({
  diaChi: DIA_CHI,
  tuShopify: { phone: '+1 850 555 0100', email: 'jane@example.com' },
  can: { sms, lark: null },
  mon: [{ tenSanPham: 'Amy Dress', sku: 'RS25-AmyDress-M-CRW', soLuong: 1, chatLieu: 'Silk' }],
  soKien: { n: 1, tong: 1 },
  ...over,
});

describe('dungKhoiVanDon', () => {
  it('đủ bốn khối, đúng thứ tự', () => {
    expect(dungKhoiVanDon(vao()).map((k) => k.ten))
      .toEqual(['Người nhận', 'Kiện hàng', 'Hàng hoá', 'Khai hải quan']);
  });
  it('khối Người nhận dán ZIP 9 số và có SĐT từ Shopify', () => {
    const k = dungKhoiVanDon(vao())[0];
    expect(k.o.find((x) => x.nhan === 'ZIP')?.giaTri).toBe('32312-3934');
    expect(k.o.find((x) => x.nhan === 'SĐT')?.giaTri).toBe('+1 850 555 0100');
    expect(k.chanCopy).toBe(false);
  });
  it('mã bang bỏ tiền tố nước (US-FL → FL) vì form hãng chỉ nhận phần sau', () => {
    expect(dungKhoiVanDon(vao())[0].o.find((x) => x.nhan === 'Bang / Tỉnh')?.giaTri).toBe('FL');
  });
  it('chưa verify → CHẶN copy khối Người nhận, các khối khác vẫn copy được', () => {
    const ks = dungKhoiVanDon(vao({ diaChi: { ...DIA_CHI, addrVerifiedAt: null } }));
    expect(ks[0]).toMatchObject({ chanCopy: true });
    expect(ks[0].lyDoChan).toMatch(/chưa verify/);
    expect(ks.slice(1).every((k) => k.chanCopy === false)).toBe(true);
  });
  it('cờ số căn hộ → băng đỏ trên khối Người nhận', () => {
    const k = dungKhoiVanDon(vao({ diaChi: { ...DIA_CHI, addrIssue: 'SuiteRequiredButMissing' } }))[0];
    expect(k.canhBao).toMatchObject({ muc: 'do', batXacNhan: true });
  });
  it('Shopify không gọi được → ô SĐT/email nói rõ, KHÔNG để trống im lặng', () => {
    const ks = dungKhoiVanDon(vao({ tuShopify: null }));
    const sdt = ks[0].o.find((x) => x.nhan === 'SĐT')!;
    expect(sdt.giaTri).toBeNull();
    expect(sdt.vi).toMatch(/không lấy được từ Shopify/);
    expect(ks[0].chanCopy).toBe(false);
  });
  it('thiếu kích thước → CHẶN copy khối Kiện hàng', () => {
    const ks = dungKhoiVanDon(vao({ can: { sms: null, lark: { hop: 'B1', canKg: 2, dai: 38, rong: 28, cao: null } } }));
    expect(ks[1]).toMatchObject({ chanCopy: true });
    expect(ks[1].lyDoChan).toMatch(/kích thước/);
    expect(ks[0].chanCopy).toBe(false);
  });
  it('khối Kiện hàng có cân quy đổi và nó CHỈ ĐỂ XEM', () => {
    const o = dungKhoiVanDon(vao())[1].o.find((x) => x.nhan === 'Cân quy đổi')!;
    expect(o.chiDeXem).toBe(true);
  });
  it('số kiện: 1 kiện → 1/1; 2 kiện → n/2; chưa có mã Lark → — kèm lý do', () => {
    expect(dungKhoiVanDon(vao())[1].o.find((x) => x.nhan === 'Số kiện')?.giaTri).toBe('1/1');
    expect(dungKhoiVanDon(vao({ soKien: { n: 2, tong: 2 } }))[1].o.find((x) => x.nhan === 'Số kiện')?.giaTri).toBe('2/2');
    const o = dungKhoiVanDon(vao({ soKien: null }))[1].o.find((x) => x.nhan === 'Số kiện')!;
    expect(o.giaTri).toBeNull();
    expect(o.vi).toMatch(/chưa có mã Lark/);
  });
  it('mỗi món ba ô: mô tả, SKU, số lượng', () => {
    const k = dungKhoiVanDon(vao())[2];
    expect(k.o.map((x) => x.nhan)).toEqual(['Món 1 — mô tả', 'Món 1 — SKU', 'Món 1 — số lượng']);
    expect(k.o[0].giaTri).toBe('Amy Dress — Silk');
  });
  /* Đơn nhiều kiện: không đoán món nào thuộc kiện nào (sku_text Lark là chuỗi dính liền và
   * null ở 6/12 kiện mẫu) — liệt kê đủ và để người đóng tự chọn. */
  it('đơn nhiều kiện → băng vàng trên khối Hàng hoá', () => {
    const k = dungKhoiVanDon(vao({ soKien: { n: 1, tong: 2 } }))[2];
    expect(k.canhBao).toMatchObject({ muc: 'vang' });
    expect(k.canhBao?.cau).toMatch(/2 kiện/);
  });
  it('khối Khai hải quan: 5 ô, tất cả để trống kèm câu "gõ tay"', () => {
    const k = dungKhoiVanDon(vao())[3];
    expect(k.o.map((x) => x.nhan))
      .toEqual(['Giá trị khai', 'Đơn vị tiền', 'HS code', 'Nước xuất xứ', 'Loại dịch vụ']);
    expect(k.o.every((x) => x.giaTri === null && /gõ tay/.test(x.vi ?? ''))).toBe(true);
    expect(k.chanCopy).toBe(false);
  });
});

describe('vanBanKhoi', () => {
  it('mỗi dòng `Nhãn: giá trị`, ô trống hiện —, bỏ ô chỉ-để-xem', () => {
    const t = vanBanKhoi(dungKhoiVanDon(vao())[1]);
    expect(t).toContain('Cân thực (kg): 2.4');
    expect(t).toContain('Loại hộp: A3');
    expect(t).not.toContain('Cân quy đổi');
    expect(vanBanKhoi(dungKhoiVanDon(vao())[3])).toContain('HS code: —');
  });
});
