import { describe, it, expect } from 'vitest';
import {
  NGUONG_DU_LIEU, NGUONG_MAC_DINH, chuanDeXuat, chuanHoaNguong, chuanHoaPhamVi, doPhu, gomTheoNuoc, tyLeNgoaiLe,
  type DongTieuChuan,
} from './tieu-chuan-giao';

const d = (o: Partial<DongTieuChuan>): DongTieuChuan => ({
  line: '', country: '', soDaGui: 0, soDaGiao: 0, soNgoaiLe: 0, soTinhChuan: o.soDaGiao ?? 0,
  tbNgay: null, p50: null, p75: null, p90: null, minNgay: null, maxNgay: null, maxNgoaiLe: null, ...o,
});

describe('tieu-chuan-giao', () => {
  it('chuanHoaPhamVi: hợp lệ giữ nguyên, rác → toàn bộ', () => {
    expect(chuanHoaPhamVi('6t')).toBe('6t');
    expect(chuanHoaPhamVi('tat-ca')).toBe('tat-ca');
    expect(chuanHoaPhamVi('99t')).toBe('tat-ca');
    expect(chuanHoaPhamVi(undefined)).toBe('tat-ca');
  });
  it('chuanDeXuat: P90 làm tròn LÊN, tính trên mẫu ĐÃ TRỪ ngoại lệ; mẫu nhỏ → null', () => {
    expect(chuanDeXuat(d({ p90: 6.0, soTinhChuan: 100 }))).toBe(6);
    expect(chuanDeXuat(d({ p90: 6.2, soTinhChuan: 100 }))).toBe(7);
    expect(chuanDeXuat(d({ p90: 0.4, soTinhChuan: 100 }))).toBe(1); // giao trong ngày vẫn chốt tối thiểu 1 ngày
    expect(chuanDeXuat(d({ p90: 6.2, soTinhChuan: NGUONG_DU_LIEU - 1 }))).toBeNull();
    // 12 kiện giao nhưng 5 là ngoại lệ → chỉ còn 7 kiện tính chuẩn, dưới ngưỡng mẫu.
    expect(chuanDeXuat(d({ p90: 6.2, soDaGiao: 12, soNgoaiLe: 5, soTinhChuan: 7 }))).toBeNull();
    expect(chuanDeXuat(d({ p90: null, soTinhChuan: 50 }))).toBeNull();
  });
  it('chuanHoaNguong: 14/20/30 giữ nguyên, "tat-ca" → null (không tách), rác → mặc định', () => {
    expect(chuanHoaNguong('14')).toBe(14);
    expect(chuanHoaNguong('30')).toBe(30);
    expect(chuanHoaNguong('tat-ca')).toBeNull();
    expect(chuanHoaNguong('7')).toBe(NGUONG_MAC_DINH);
    expect(chuanHoaNguong(undefined)).toBe(NGUONG_MAC_DINH);
  });
  it('tyLeNgoaiLe: phần kiện giao chậm bất thường trên tổng kiện đã giao', () => {
    expect(tyLeNgoaiLe(d({ soDaGiao: 200, soNgoaiLe: 10 }))).toBeCloseTo(0.05, 5);
    expect(tyLeNgoaiLe(d({ soDaGiao: 0, soNgoaiLe: 0 }))).toBeNull();
  });
  it('doPhu: tỉ lệ kiện đã ghi nhận giao; chưa gửi kiện nào → null', () => {
    expect(doPhu(d({ soDaGui: 200, soDaGiao: 150 }))).toBeCloseTo(0.75, 5);
    expect(doPhu(d({ soDaGui: 0, soDaGiao: 0 }))).toBeNull();
  });
  it('gomTheoNuoc: ghép nước với line của nó, sắp theo kiện giao giảm dần, bỏ nước/line chưa giao', () => {
    const nuoc = [
      d({ country: 'US', soDaGui: 120, soDaGiao: 100, p90: 7 }),
      d({ country: 'SA', soDaGui: 300, soDaGiao: 250, p90: 11 }),
      d({ country: 'VN', soDaGui: 5, soDaGiao: 0 }), // chưa ghi nhận giao → bỏ
    ];
    const lineNuoc = [
      d({ line: 'fedex', country: 'US', soDaGiao: 60 }),
      d({ line: 'dhl', country: 'US', soDaGiao: 40 }),
      d({ line: 'aramex', country: 'US', soDaGiao: 0 }), // line chưa giao → bỏ
      d({ line: 'fedex', country: 'SA', soDaGiao: 250 }),
      d({ line: 'fedex', country: 'VN', soDaGiao: 0 }),
    ];
    const g = gomTheoNuoc(nuoc, lineNuoc);
    expect(g.map((x) => x.tong.country)).toEqual(['SA', 'US']);
    expect(g[0].lines.map((l) => l.line)).toEqual(['fedex']);
    expect(g[1].lines.map((l) => l.line)).toEqual(['fedex', 'dhl']);
  });
});
