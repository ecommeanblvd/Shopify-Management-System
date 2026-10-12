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
