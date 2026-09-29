import { describe, it, expect } from 'vitest';
import { tachSoCreditNote, khopKyHieu, thieuChungTu } from './credit-note-thieu';

describe('tachSoCreditNote', () => {
  it('dạng chuẩn trên dòng đối soát', () => {
    expect(tachSoCreditNote('K26TFA-35641')).toEqual({ kyHieu: 'K26TFA', so: '35641' });
  });
  it('chấp nhận gạch chéo và khoảng trắng', () => {
    expect(tachSoCreditNote('1K26TFA/44519')).toEqual({ kyHieu: '1K26TFA', so: '44519' });
    expect(tachSoCreditNote(' K26TFA 35641 ')).toEqual({ kyHieu: 'K26TFA', so: '35641' });
  });
  it('gõ sai định dạng → null, KHÔNG được lặng lẽ coi là khớp', () => {
    expect(tachSoCreditNote('linh tinh')).toBeNull();
    expect(tachSoCreditNote('')).toBeNull();
    expect(tachSoCreditNote(null)).toBeNull();
  });
});

describe('khopKyHieu — chứng từ có tiền tố mẫu số', () => {
  it('"1K26TFA" trên chứng từ khớp "K26TFA" người đối soát gõ', () => {
    expect(khopKyHieu('1K26TFA', 'K26TFA')).toBe(true);
    expect(khopKyHieu('K26TFA', '1K26TFA')).toBe(true);
  });
  it('ký hiệu khác nhau thì không khớp', () => {
    expect(khopKyHieu('1K26THA', 'K26TFA')).toBe(false);
    expect(khopKyHieu('', 'K26TFA')).toBe(false);
  });
});

describe('thieuChungTu', () => {
  it('gom theo SỐ TỜ, không theo dòng — một tờ phủ nhiều kiện', () => {
    // Thật: tờ K26TFA-35641 phủ 6 dòng đối soát ngày 03/08.
    const t = thieuChungTu([
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 1_000_000 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 2_000_000 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 3_000_000 },
    ], []);
    expect(t.soTo).toBe(1);
    expect(t.tienVnd).toBe(6_000_000);
    expect(t.danhSach).toEqual(['K26TFA-35641']);
  });

  it('tờ ĐÃ có chứng từ thì không báo thiếu, kể cả khi ký hiệu có tiền tố mẫu số', () => {
    const t = thieuChungTu(
      [{ soCreditNote: 'K26TFA-44519', thuHoiVnd: 5_019_271 }],
      [{ kyHieu: '1K26TFA', so: '44519' }],
    );
    expect(t.soTo).toBe(0);
    expect(t.tienVnd).toBe(0);
  });

  it('trùng SỐ nhưng khác KÝ HIỆU thì vẫn là thiếu — không được nhận nhầm tờ của hãng khác', () => {
    // Chứng từ DHL 1K26THA/463 không được tính là đã có cho K26TFA-463.
    const t = thieuChungTu(
      [{ soCreditNote: 'K26TFA-463', thuHoiVnd: 900_000 }],
      [{ kyHieu: '1K26THA', so: '463' }],
    );
    expect(t.soTo).toBe(1);
  });

  it('đòi được tiền mà KHÔNG ghi số tờ cũng là thiếu chứng từ', () => {
    const t = thieuChungTu([{ soCreditNote: null, thuHoiVnd: 700_000 }], []);
    expect(t.soTo).toBe(1);
    expect(t.danhSach).toEqual(['(chưa ghi số)']);
  });

  it('dòng chưa đòi được đồng nào thì không tính là thiếu chứng từ', () => {
    expect(thieuChungTu([{ soCreditNote: 'K26TFA-1', thuHoiVnd: 0 }], []).soTo).toBe(0);
  });

  it('số tháng 8 thật: 6 dòng thuộc 1 tờ, chưa tải lên → 17.278.490đ chưa được tính', () => {
    const t = thieuChungTu([
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 632_034 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 1_706_939 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 1_143_537 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 1_408_795 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 8_093_165 },
      { soCreditNote: 'K26TFA-35641', thuHoiVnd: 4_294_020 },
    ], [{ kyHieu: '1K26THA', so: '463' }]);
    expect(t.soTo).toBe(1);
    expect(t.tienVnd).toBe(17_278_490);
  });
});
