import { describe, it, expect } from 'vitest';
import {
  CAM_KET_NUOC, LO_TRINH_LOI, chamKpi, loiToiDaTaiNgay, mienCuaNuoc, slaCuaLine, slaCuaNuoc, tongKpi, type KienGiao,
} from './sop-giao-hang';

const k = (country: string, line: string, soNgay: number): KienGiao => ({ country, line, soNgay });
const lay = (rows: ReturnType<typeof chamKpi>, cc: string) => rows.find((r) => r.country === cc)!;
const KY = '2026-09-01';

describe('sop-giao-hang', () => {
  it('slaCuaNuoc: nước đã khai lấy mức riêng, nước khác lấy mức của miền', () => {
    expect(slaCuaNuoc('US')).toBe(5);
    expect(slaCuaNuoc('sa')).toBe(7);
    expect(slaCuaNuoc('HK')).toBe(3);
    expect(slaCuaNuoc('NL')).toBe(mienCuaNuoc('NL').slaNgay); // chưa khai riêng → mức Châu Âu
    expect(slaCuaNuoc('ZW')).toBe(10); // nhóm còn lại
  });
  it('slaCuaLine: hãng nhanh hơn có thước riêng, hãng khác dùng mức của nước', () => {
    expect(slaCuaLine('SA', 'aramex')).toBe(4);
    expect(slaCuaLine('SA', 'fedex')).toBe(7);
    expect(slaCuaLine('sa', 'ARAMEX')).toBe(4);
    expect(slaCuaLine('NL', 'aramex')).toBe(slaCuaNuoc('NL'));
  });
  it('mức nội bộ của hãng không được lỏng hơn cam kết với khách', () => {
    for (const [cc, ck] of Object.entries(CAM_KET_NUOC)) {
      for (const [line, sla] of Object.entries(ck.theoLine ?? {})) {
        expect(`${cc}/${line}=${sla}`).toBe(`${cc}/${line}=${Math.min(sla, ck.slaNgay)}`);
      }
    }
  });
  it('loiToiDaTaiNgay: siết dần theo lộ trình, trước mốc đầu dùng mốc đầu', () => {
    expect(loiToiDaTaiNgay('2026-09-01').loiToiDa).toBe(0.35);
    expect(loiToiDaTaiNgay('2025-05-01').loiToiDa).toBe(0.35);
    expect(loiToiDaTaiNgay('2027-01-01').loiToiDa).toBe(0.28);
    expect(loiToiDaTaiNgay('2027-08-15').loiToiDa).toBe(0.15);
    expect(loiToiDaTaiNgay('2028-03-01').loiToiDa).toBe(0.10);
    expect(LO_TRINH_LOI.map((m) => m.loiToiDa)).toEqual([...LO_TRINH_LOI.map((m) => m.loiToiDa)].sort((a, b) => b - a));
  });
  it('chấm theo nước và theo từng hãng, mỗi hãng bằng thước của nó', () => {
    const r = lay(chamKpi([
      k('SA', 'aramex', 4), k('SA', 'aramex', 6), // Aramex SLA 4 → 1 đúng, 1 trễ
      k('SA', 'fedex', 6), k('SA', 'fedex', 7), k('SA', 'fedex', 9), // FedEx SLA 7 → 2 đúng, 1 trễ
    ], KY), 'SA');
    expect(r.slaNgay).toBe(7);
    expect(r.dungHan).toBe(4); // mức nước 7 ngày: chỉ kiện 9 ngày là trễ
    const ara = r.theoLine.find((l) => l.line === 'aramex')!;
    expect(ara.slaNgay).toBe(4);
    expect(ara.dungHan).toBe(1);
    expect(ara.tyLeTre).toBeCloseTo(0.5, 5);
    expect(ara.dat).toBe(false); // 50 % > 35 %
    const fed = r.theoLine.find((l) => l.line === 'fedex')!;
    expect(fed.dungHan).toBe(2);
    expect(fed.dat).toBe(true); // 33 % ≤ 35 %
  });
  it('kiện quá ngưỡng ngoại lệ vẫn tính là trễ, chỉ tách để quy nguyên nhân', () => {
    const r = lay(chamKpi([k('US', 'fedex', 3), k('US', 'fedex', 9), k('US', 'fedex', 40)], KY), 'US');
    expect(r.treVanChuyen).toBe(1);
    expect(r.ngoaiLe).toBe(1);
    expect(r.tyLeTre).toBeCloseTo(2 / 3, 5);
  });
  it('loại Việt Nam; sắp nước theo số kiện giảm dần', () => {
    const rows = chamKpi([k('VN', 'fedex', 190), k('US', 'fedex', 3), k('US', 'fedex', 4), k('JP', 'fedex', 2)], KY);
    expect(rows.map((r) => r.country)).toEqual(['US', 'JP']);
  });
  it('tongKpi: gộp mọi nước, dùng mức lỗi của kỳ', () => {
    const rows = chamKpi([...Array.from({ length: 7 }, () => k('US', 'fedex', 3)), ...Array.from({ length: 3 }, () => k('US', 'fedex', 12))], KY);
    const t = tongKpi(rows, KY);
    expect(t.n).toBe(10); expect(t.dungHan).toBe(7);
    expect(t.loiToiDa).toBe(0.35);
    expect(t.dat).toBe(true); // 30 % ≤ 35 %
    expect(tongKpi(rows, '2027-05-01').dat).toBe(false); // cùng số liệu, kỳ siết 22 % → trượt
  });
});
