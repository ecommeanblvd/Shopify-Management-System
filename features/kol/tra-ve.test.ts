import { describe, it, expect } from 'vitest';
import { conNo, kiemTraVe } from './tra-ve';
import type { DongDon } from './types';

const d = (o: Partial<DongDon>): DongDon => ({
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 3, hinhThuc: 'muon',
  hanTra: '2026-10-01', giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0, ...o,
});

describe('conNo', () => {
  it('chưa trả gì thì nợ cả số lượng', () => { expect(conNo(d({}))).toBe(3); });
  it('trả một phần', () => { expect(conNo(d({ soLuongDaTra: 2 }))).toBe(1); });
  it('trả đủ thì hết nợ', () => { expect(conNo(d({ soLuongDaTra: 3 }))).toBe(0); });
  it('hàng tặng không nợ gì', () => { expect(conNo(d({ hinhThuc: 'tang' }))).toBe(0); });
});

describe('kiemTraVe', () => {
  it('trả trong phạm vi còn nợ thì được', () => {
    expect(kiemTraVe(d({}), 2, true, null)).toEqual({ ok: true });
  });
  it('trả VƯỢT số còn nợ thì chặn', () => {
    const r = kiemTraVe(d({ soLuongDaTra: 2 }), 2, true, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain('còn nợ 1');
  });
  it('số lượng không dương thì chặn', () => {
    expect(kiemTraVe(d({}), 0, true, null).ok).toBe(false);
    expect(kiemTraVe(d({}), -1, true, null).ok).toBe(false);
  });
  it('hàng TẶNG không có đường trả', () => {
    const r = kiemTraVe(d({ hinhThuc: 'tang' }), 1, true, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain('tặng');
  });
  it('không nhập lại kho thì BẮT BUỘC ghi lý do', () => {
    expect(kiemTraVe(d({}), 1, false, null).ok).toBe(false);
    expect(kiemTraVe(d({}), 1, false, '   ').ok).toBe(false);
    expect(kiemTraVe(d({}), 1, false, 'Váy rách gấu').ok).toBe(true);
  });
});
