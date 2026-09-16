import { describe, it, expect } from 'vitest';
import { deXuatTuMotDon, tongHopDeXuat, laThungQuaTo } from './de-xuat';

// Số lấy từ đơn thật T8/2026.
describe('deXuatTuMotDon', () => {
  it('#MBLVD29593: váy 800g, hãng tính 2kg → đề xuất 2.000g', () => {
    const r = deXuatTuMotDon({ maDon: '#MBLVD29593', billedKg: 2, dong: [{ sku: 'Calista-4951339-S-WHI', soLuong: 1, canHienTaiG: 800 }] });
    expect(r.get('Calista-4951339-S-WHI')).toBe(2000);
  });

  it('#MBLVD29653: hai món 700g + 500g, hãng tính 2kg → chia theo tỉ lệ cân, làm tròn lên', () => {
    const r = deXuatTuMotDon({ maDon: '#MBLVD29653', billedKg: 2, dong: [
      { sku: 'A', soLuong: 1, canHienTaiG: 700 },
      { sku: 'B', soLuong: 1, canHienTaiG: 500 },
    ] });
    expect(r.get('A')).toBe(1200); // 2000 × 700/1200 = 1166,7 → 1200
    expect(r.get('B')).toBe(900);  // 2000 × 500/1200 = 833,3 → 900
    expect((r.get('A') ?? 0) + (r.get('B') ?? 0)).toBeGreaterThanOrEqual(2000);
  });

  it('chỉ sửa SKU được ghi là cần sửa; món còn lại giữ cân và được trừ ra trước', () => {
    const r = deXuatTuMotDon({ maDon: 'x', billedKg: 2, skuMucTieu: ['A'], dong: [
      { sku: 'A', soLuong: 1, canHienTaiG: 700 },
      { sku: 'B', soLuong: 1, canHienTaiG: 500 },
    ] });
    expect(r.get('A')).toBe(1500);
    expect(r.has('B')).toBe(false);
  });

  it('số lượng 2 thì chia cho từng món', () => {
    const r = deXuatTuMotDon({ maDon: 'x', billedKg: 3, dong: [{ sku: 'A', soLuong: 2, canHienTaiG: 800 }] });
    expect(r.get('A')).toBe(1500);
  });

  it('web đã khai đủ hoặc cao hơn hãng tính thì không đề xuất', () => {
    expect(deXuatTuMotDon({ maDon: '#MBLVD29568', billedKg: 2, dong: [{ sku: 'A', soLuong: 1, canHienTaiG: 4700 }] }).size).toBe(0);
  });

  it('chưa biết cân hiện tại thì chia đều theo số lượng', () => {
    const r = deXuatTuMotDon({ maDon: 'x', billedKg: 2, dong: [
      { sku: 'A', soLuong: 1, canHienTaiG: null }, { sku: 'B', soLuong: 1, canHienTaiG: null },
    ] });
    expect(r.get('A')).toBe(1000);
  });
});

describe('tongHopDeXuat', () => {
  it('nhiều đơn cùng SKU → lấy mức cao nhất, giữ đủ bằng chứng', () => {
    const r = tongHopDeXuat([
      { maDon: 'd1', billedKg: 2, dong: [{ sku: 'A', soLuong: 1, canHienTaiG: 800 }] },
      { maDon: 'd2', billedKg: 2.5, dong: [{ sku: 'A', soLuong: 1, canHienTaiG: 800 }] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].canDeXuatG).toBe(2500);
    expect(r[0].bangChung.map((b) => b.maDon)).toEqual(['d1', 'd2']);
  });

  it('xếp SKU tăng nhiều nhất lên đầu', () => {
    const r = tongHopDeXuat([
      { maDon: 'd1', billedKg: 1, dong: [{ sku: 'nho', soLuong: 1, canHienTaiG: 800 }] },
      { maDon: 'd2', billedKg: 5, dong: [{ sku: 'lon', soLuong: 1, canHienTaiG: 800 }] },
    ]);
    expect(r.map((d) => d.sku)).toEqual(['lon', 'nho']);
  });
});

describe('cờ thùng quá to', () => {
  it('#MBLVD29923: váy 1,6kg đi thùng 45×29×28 (quy đổi 7,3kg) → nghi thùng quá to', () => {
    expect(laThungQuaTo(1.6, 7.308)).toBe(true);
  });
  it('váy 1,2kg đi thùng chuẩn 39×28×9 (quy đổi 1,97kg) → không nghi', () => {
    expect(laThungQuaTo(1.2, 1.97)).toBe(false);
  });
  it('đề xuất mang cờ theo đúng đơn đẩy mức cao nhất', () => {
    const r = tongHopDeXuat([
      { maDon: 'thung-chuan', billedKg: 2, dong: [{ sku: 'A', soLuong: 1, canHienTaiG: 800 }] },
      { maDon: 'thung-to', billedKg: 7.3, thungQuaTo: true, dong: [{ sku: 'A', soLuong: 1, canHienTaiG: 800 }] },
    ]);
    expect(r[0].canDeXuatG).toBe(7300);
    expect(r[0].nghiThungTo).toBe(true);
  });
});
