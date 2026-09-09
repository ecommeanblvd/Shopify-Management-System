import { describe, it, expect } from 'vitest';
import { giaVonThucTheoDong, type DongCogs } from './gia-von-thuc';

const d = (p: Partial<DongCogs>): DongCogs => ({ shopifyLineId: 'L1', kind: 'cogs', amount: 1_000_000, currency: 'VND', source: 'brand_statement', period: '2026-05', statementRef: 'denio 2026-05', ...p });

describe('giaVonThucTheoDong', () => {
  it('một dòng bảng kê → giá vốn thực = amount, nguồn/kỳ/ref giữ', () => {
    const m = giaVonThucTheoDong([d({})]);
    expect(m.get('L1')).toEqual({ vnd: 1_000_000, nguon: 'brand_statement', ky: '2026-05', ref: 'denio 2026-05', coReturn: false });
  });
  it('mmp đè brand_statement; cùng nguồn lấy kỳ mới nhất', () => {
    const m = giaVonThucTheoDong([d({ amount: 900_000 }), d({ source: 'mmp', amount: 950_000, period: '2026-05' }), d({ source: 'brand_statement', amount: 800_000, period: '2026-04' })]);
    expect(m.get('L1')!.vnd).toBe(950_000); expect(m.get('L1')!.nguon).toBe('mmp');
    const m2 = giaVonThucTheoDong([d({ amount: 800_000, period: '2026-04' }), d({ amount: 900_000, period: '2026-06' })]);
    expect(m2.get('L1')!.vnd).toBe(900_000); expect(m2.get('L1')!.ky).toBe('2026-06');
  });
  it('return (âm) trừ vào giá vốn thực của dòng; dòng chỉ có return → không có giá thực', () => {
    const m = giaVonThucTheoDong([d({}), d({ kind: 'return', amount: -1_000_000, period: '2026-06' })]);
    expect(m.get('L1')).toMatchObject({ vnd: 0, coReturn: true });
    expect(giaVonThucTheoDong([d({ kind: 'return', amount: -500_000 })]).has('L1')).toBe(false);
  });
  it('dòng còn USD (sheet chưa có mốc ₫) bị bỏ; dòng khác không ảnh hưởng', () => {
    const m = giaVonThucTheoDong([d({ currency: 'USD', amount: 40 }), d({ shopifyLineId: 'L2', amount: 2_000_000, source: 'po' })]);
    expect(m.has('L1')).toBe(false); expect(m.get('L2')!.nguon).toBe('po');
  });
});
