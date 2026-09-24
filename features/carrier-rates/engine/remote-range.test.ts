import { describe, it, expect } from 'vitest';
import { chuanHoaMa, tienToTheoDoDai, beRongDai, khopDai, type DaiMaBuuChinh } from './remote-range';

const dai = (batDau: string, ketThuc: string, tier: string | null = 'Extended'): DaiMaBuuChinh =>
  ({ batDau, ketThuc, doDai: batDau.length, tier });

describe('chuanHoaMa', () => {
  it('viết hoa và bỏ mọi ký tự không phải chữ/số', () => {
    expect(chuanHoaMa('98077-5629')).toBe('980775629');
    expect(chuanHoaMa('a0j 1v0')).toBe('A0J1V0');
    expect(chuanHoaMa(null)).toBe('');
    expect(chuanHoaMa('  ')).toBe('');
  });
});

describe('tienToTheoDoDai', () => {
  it('sinh đủ mọi tiền tố kèm độ dài', () => {
    expect(tienToTheoDoDai('987')).toEqual([
      { doDai: 1, khoa: '9' }, { doDai: 2, khoa: '98' }, { doDai: 3, khoa: '987' },
    ]);
  });

  it('ZIP+4 sinh ra tiền tố 5 ký tự — chính là mã hãng lưu', () => {
    expect(tienToTheoDoDai('98077-5629')).toContainEqual({ doDai: 5, khoa: '98077' });
  });

  it('chặn theo giới hạn để mã rác không làm nổ số truy vấn', () => {
    expect(tienToTheoDoDai('12345678901234567890', 12)).toHaveLength(12);
  });
});

describe('beRongDai', () => {
  it('dải toàn chữ số đếm theo cơ số 10', () => {
    expect(beRongDai(dai('10000', '10000'))).toBe(1);
    expect(beRongDai(dai('10000', '10009'))).toBe(10);
    expect(beRongDai(dai('6441000', '7999999'))).toBe(1_559_000);
    // Bẫy của base-36: '1000'–'1999' phải hẹp hơn hẳn, không được tính thành 11.988.
    expect(beRongDai(dai('1000', '1999'))).toBe(1000);
  });

  it('dải có chữ đếm theo base-36', () => {
    expect(beRongDai(dai('A0A1A0', 'A0A1A1'))).toBe(2);
  });
});

describe('khopDai', () => {
  it('mã nằm trong dải thì khớp, ngoài thì không', () => {
    const ds = [dai('06390', '06390'), dai('07001', '07099', 'Remote')];
    expect(khopDai(ds, '07050')?.tier).toBe('Remote');
    expect(khopDai(ds, '06390')?.tier).toBe('Extended');
    expect(khopDai(ds, '07100')).toBeNull();
  });

  it('cắt mã dài hơn bề rộng dải — ZIP+4 khớp dải 5 ký tự', () => {
    const ds = [dai('98070', '98079')];
    expect(khopDai(ds, '98077-5629')?.tier).toBe('Extended');
  });

  it('mã NGẮN hơn bề rộng dải thì bỏ qua, không đoán bừa', () => {
    expect(khopDai([dai('98070', '98079')], '980')).toBeNull();
  });

  it('so sánh chữ-số theo byte: mã bưu chính Canada', () => {
    const ds = [dai('A0A1A0', 'A0J1V0')];
    expect(khopDai(ds, 'A0B 1C0')?.tier).toBe('Extended');
    expect(khopDai(ds, 'A0K 1A0')).toBeNull();
  });

  it('dải phủ cả nước (Angola 000000–999999)', () => {
    expect(khopDai([dai('000000', '999999')], '123456')?.tier).toBe('Extended');
  });

  it('LUẬT: dải HẸP hơn thắng khi một mã rơi vào nhiều dải', () => {
    const rong = dai('10000', '19999', 'Extended');
    const hep = dai('10500', '10599', 'Remote');
    expect(khopDai([rong, hep], '10550')?.tier).toBe('Remote');
    // Thứ tự dòng từ DB không được đổi kết quả.
    expect(khopDai([hep, rong], '10550')?.tier).toBe('Remote');
  });

  it('LUẬT: bằng bề rộng thì batDau nhỏ hơn thắng — kết quả tất định', () => {
    const a = dai('10000', '10099', 'A');
    const b = dai('10050', '10149', 'B');
    expect(khopDai([a, b], '10060')?.tier).toBe('A');
    expect(khopDai([b, a], '10060')?.tier).toBe('A');
  });

  it('LUẬT: bằng cả bề rộng lẫn batDau thì nhãn tier nhỏ hơn thắng, NULL đứng cuối', () => {
    const khongTier = dai('10000', '10099', null);
    const coTier = dai('10000', '10099', 'Remote');
    expect(khopDai([khongTier, coTier], '10010')?.tier).toBe('Remote');
    expect(khopDai([coTier, khongTier], '10010')?.tier).toBe('Remote');
    const b = dai('10000', '10099', 'B');
    expect(khopDai([b, coTier], '10010')?.tier).toBe('B');
  });

  it('không có dải / mã rỗng → null', () => {
    expect(khopDai(undefined, '10000')).toBeNull();
    expect(khopDai([], '10000')).toBeNull();
    expect(khopDai([dai('10000', '19999')], null)).toBeNull();
  });
});
