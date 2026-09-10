import { describe, it, expect } from 'vitest';
import { NHOM_SOP, chamKpi, nhomCuaNuoc, tongKpi, type KienGiao } from './sop-giao-hang';

const k = (country: string, soNgay: number): KienGiao => ({ country, soNgay });
const lay = (rows: ReturnType<typeof chamKpi>, ma: string) => rows.find((r) => r.nhom.ma === ma)!;

describe('sop-giao-hang', () => {
  it('nhomCuaNuoc: theo bảng; nước lạ rơi vào nhóm cuối', () => {
    expect(nhomCuaNuoc('JP').ma).toBe('chau-a');
    expect(nhomCuaNuoc('us').ma).toBe('bac-my-anh-uc');
    expect(nhomCuaNuoc('DE').ma).toBe('chau-au');
    expect(nhomCuaNuoc('AE').ma).toBe('uae');
    expect(nhomCuaNuoc('SA').ma).toBe('trung-dong');
    expect(nhomCuaNuoc('ZW').ma).toBe('khac');
  });
  it('mỗi nước chỉ thuộc đúng một nhóm', () => {
    const all = NHOM_SOP.flatMap((n) => n.nuoc);
    expect(all.length).toBe(new Set(all).size);
  });
  it('chấm KPI: đúng hạn khi ≤ SLA; trễ tách vận chuyển và ngoại lệ; cả hai đều là trễ', () => {
    // Nhóm Bắc Mỹ SLA 7, lỗi tối đa 10 %.
    const r = lay(chamKpi([
      ...Array.from({ length: 9 }, () => k('US', 5)), // đúng hạn
      k('US', 7),                                     // đúng hạn (bằng SLA)
      k('US', 9),                                     // trễ vận chuyển
      k('US', 44),                                    // ngoại lệ
    ]), 'bac-my-anh-uc');
    expect(r.n).toBe(12);
    expect(r.dungHan).toBe(10);
    expect(r.treVanChuyen).toBe(1);
    expect(r.ngoaiLe).toBe(1);
    expect(r.tyLeTre).toBeCloseTo(2 / 12, 5);
    expect(r.dat).toBe(false); // 16,7 % > 10 %
  });
  it('đạt KPI khi tỉ lệ trễ đúng bằng mức cho phép', () => {
    const r = lay(chamKpi([...Array.from({ length: 9 }, () => k('CA', 3)), k('CA', 30)]), 'bac-my-anh-uc');
    expect(r.tyLeTre).toBeCloseTo(0.1, 5);
    expect(r.dat).toBe(true);
  });
  it('loại Việt Nam khỏi KPI; nhóm không có kiện thì không chấm', () => {
    const rows = chamKpi([k('VN', 190), k('JP', 2)]);
    expect(lay(rows, 'chau-a').n).toBe(1);
    expect(lay(rows, 'khac').n).toBe(0);
    expect(lay(rows, 'khac').dat).toBeNull();
    expect(lay(rows, 'khac').tyLeDungHan).toBeNull();
  });
  it('chi tiết theo nước sắp theo số kiện giảm dần', () => {
    const r = lay(chamKpi([k('JP', 2), k('JP', 3), k('JP', 9), k('SG', 1)]), 'chau-a');
    expect(r.theoNuoc.map((x) => x.country)).toEqual(['JP', 'SG']);
    expect(r.theoNuoc[0].dungHan).toBe(2);
    expect(r.theoNuoc[0].dat).toBe(false); // 1/3 trễ
  });
  it('tongKpi: gộp mọi nhóm, chỉ đạt khi KHÔNG nhóm nào trượt', () => {
    const rows = chamKpi([...Array.from({ length: 10 }, () => k('JP', 2)), ...Array.from({ length: 10 }, () => k('US', 20))]);
    const t = tongKpi(rows);
    expect(t.n).toBe(20);
    expect(t.dungHan).toBe(10);
    expect(t.soNhomDat).toBe(1);
    expect(t.soNhomCham).toBe(1);
    expect(t.dat).toBe(false);
  });
});
