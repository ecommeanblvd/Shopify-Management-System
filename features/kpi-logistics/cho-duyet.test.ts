import { describe, it, expect } from 'vitest';
import { viecChoDuyet, duDieuKienChot, type DauVaoChoDuyet } from './cho-duyet';

const nen: DauVaoChoDuyet = {
  ky: '2026-08', kienChoDuyet: 0, monCanChoDuyet: 0,
  daChamP3B: true, daChot: false, p1ChuaCham: 0, donChuaPhanDinh: 0,
};
const ma = (v: Partial<DauVaoChoDuyet>) => viecChoDuyet({ ...nen, ...v }).map((x) => x.ma);

describe('viecChoDuyet', () => {
  it('không việc gì chờ thì danh sách rỗng — không hiện dải trống', () => {
    expect(viecChoDuyet({ ...nen, daChot: true })).toEqual([]);
  });

  it('đơn âm cước treo đứng ĐẦU: nó chặn cả 1.1 lẫn việc chốt', () => {
    const r = ma({ donChuaPhanDinh: 6, kienChoDuyet: 5, monCanChoDuyet: 3, daChamP3B: false });
    expect(r[0]).toBe('phan-dinh-1-1');
    expect(r).toEqual(['phan-dinh-1-1', 'duyet-ly-do', 'cham-3b', 'duyet-can']);
  });

  it('còn việc dở thì KHÔNG mời chốt', () => {
    expect(ma({ donChuaPhanDinh: 6 })).not.toContain('chot-ky');
    expect(ma({ p1ChuaCham: 1 })).not.toContain('chot-ky');
  });

  it('hết việc dở thì mời chốt, và lời mời đứng CUỐI', () => {
    const r = ma({ monCanChoDuyet: 3 });
    expect(r).toEqual(['duyet-can', 'chot-ky']);
  });

  it('kỳ ĐÃ CHỐT thì thôi nhắc chấm 3B và thôi mời chốt', () => {
    const r = ma({ daChot: true, daChamP3B: false, donChuaPhanDinh: 4 });
    expect(r).toEqual([]);
  });

  it('kỳ đã chốt vẫn nhắc việc KHÔNG thuộc kỳ: duyệt tay và duyệt cân', () => {
    // Hai việc này đo trên toàn thời gian, kỳ đóng lại không làm chúng biến mất.
    expect(ma({ daChot: true, kienChoDuyet: 5, monCanChoDuyet: 3 })).toEqual(['duyet-ly-do', 'duyet-can']);
  });

  it('câu nhãn nói thẳng con số, không nói chung chung', () => {
    const v = viecChoDuyet({ ...nen, kienChoDuyet: 5, monCanChoDuyet: 3 });
    expect(v[0].nhan).toContain('5 kiện');
    expect(v[1].nhan).toContain('3 món');
    expect(v[1].href).toBe('/f/can-san-pham');
    expect(v[0].href).toBeNull();
  });
});

describe('duDieuKienChot', () => {
  it('đủ điều kiện khi mọi tiêu chí P1 chấm được và không còn đơn treo', () => {
    expect(duDieuKienChot({ p1ChuaCham: 0, donChuaPhanDinh: 0, daChot: false })).toBe(true);
  });

  it('CỐ Ý không đòi 3B đã chấm — 3B trống vẫn chốt được', () => {
    // 3B để trống chỉ là không đóng góp điểm; P1 chưa chấm mà chốt mới là khoá vĩnh viễn số sai.
    expect(duDieuKienChot({ p1ChuaCham: 0, donChuaPhanDinh: 0, daChot: false })).toBe(true);
  });

  it('còn tiêu chí P1 chưa chấm → chưa đủ (ca thật T8: chốt lúc đó khoá P1 ở 70% thay vì 85%)', () => {
    expect(duDieuKienChot({ p1ChuaCham: 1, donChuaPhanDinh: 6, daChot: false })).toBe(false);
  });

  it('đã chốt rồi thì không mời chốt nữa', () => {
    expect(duDieuKienChot({ p1ChuaCham: 0, donChuaPhanDinh: 0, daChot: true })).toBe(false);
  });
});
