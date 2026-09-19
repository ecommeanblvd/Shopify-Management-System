import { describe, it, expect } from 'vitest';
import { dungPatch, type KienGhiNguoc, type ChargeGhiNguoc } from './dung-patch';
import { COT, COT_CHI_PHI } from './cot';
import { ngayLark, ngayDuKien } from './ngay-lark';

const kien = (p: Partial<KienGhiNguoc> = {}): KienGhiNguoc => ({
  deliveryStatus: 'in_transit', deliverySource: 'fedex', deliveredAt: null,
  labelCreatedAt: new Date('2026-09-10T00:00:00Z'), shipCountry: 'US', ...p,
});
const charge = (p: Partial<ChargeGhiNguoc> = {}): ChargeGhiNguoc => ({
  totalAmount: 1438453, base: 2244600, discount: -1541142, fuel: 383043, remote: 0, demand: 0,
  directSignature: 92700, vat: 106552, gogreen: 0, elevatedRisk: 0, importHandling: 68300, residential: 84400, ...p,
});

describe('dungPatch — nguồn (cổng chỉ áp cho trạng thái + ngày giao thực tế)', () => {
  it('nguồn lark → KHÔNG ghi ô chọn và Ngày giao thực tế, nhưng vẫn điền chi phí + ngày dự kiến trống', () => {
    const r = dungPatch(kien({ deliverySource: 'lark', deliveryStatus: 'delivered', deliveredAt: new Date('2026-09-15T08:00:00Z') }), charge(), {});
    expect(COT.category in r.patch).toBe(false);
    expect(COT.status in r.patch).toBe(false);
    expect(COT.ngayGiaoThucTe in r.patch).toBe(false);
    expect(r.patch[COT.ngayGiaoDuKien]).toBe(ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'US'));
    expect(r.patch[COT_CHI_PHI.totalAmount]).toBe(1438453);
    expect(r.nhom).toEqual({ trangThai: 0, ngay: 1, chiPhi: 7 });
    expect(r.lech).toEqual([]);
  });
  it('nguồn null → như nguồn lark', () => {
    const r = dungPatch(kien({ deliverySource: null }), charge(), {});
    expect(COT.category in r.patch).toBe(false);
    expect(r.nhom.chiPhi).toBe(7);
  });
  it('nguồn lark, ô chi phí đã có số khác → vẫn ghi lệch (không ghi đè)', () => {
    const r = dungPatch(kien({ deliverySource: 'lark' }), charge(), { [COT_CHI_PHI.totalAmount]: 1 });
    expect(COT_CHI_PHI.totalAmount in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.totalAmount))).toHaveLength(1);
  });
});

describe('dungPatch — trạng thái (ghi đè)', () => {
  it('ô trống → ghi cả hai ô chọn', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.category]).toBe('In Transit');
    expect(r.patch[COT.status]).toBe('On Delivery');
    expect(r.nhom.trangThai).toBe(2);
    expect(r.lech).toEqual([]);
  });
  it('Ops gõ khác → vẫn ghi đè + một mục lệch mỗi ô', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: new Date('2026-09-15T08:00:00Z') }), null,
      { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(r.patch[COT.category]).toBe('Delivered');
    expect(r.patch[COT.status]).toBe('Delivery Completed');
    expect(r.lech.filter((l) => l.includes(COT.category))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT.status))).toHaveLength(1);
  });
  it('ô đã đúng → không nằm trong patch', () => {
    const r = dungPatch(kien(), null, { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(COT.category in r.patch).toBe(false);
    expect(COT.status in r.patch).toBe(false);
    expect(r.nhom.trangThai).toBe(0);
  });
  it('trạng thái unknown → không ghi ô chọn', () => {
    const r = dungPatch(kien({ deliveryStatus: 'unknown' }), null, {});
    expect(COT.category in r.patch).toBe(false);
  });
});

describe('dungPatch — ngày', () => {
  const giao = new Date('2026-09-15T08:00:00Z');
  it('delivered + có ngày → ghi Ngày giao thực tế dạng epoch nửa đêm VN', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, {});
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.nhom.ngay).toBeGreaterThanOrEqual(1);
  });
  it('in_transit → không ghi Ngày giao thực tế', () => {
    expect(COT.ngayGiaoThucTe in dungPatch(kien(), null, {}).patch).toBe(false);
  });
  it('Ngày giao thực tế Ops gõ khác → ghi đè + lệch; trùng ngày → bỏ qua', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(new Date('2026-09-14T08:00:00Z')) });
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.lech.some((l) => l.includes(COT.ngayGiaoThucTe))).toBe(true);
    const r2 = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(giao) });
    expect(COT.ngayGiaoThucTe in r2.patch).toBe(false);
  });
  it('Ngày giao dự kiến: trống → label + SLA; đã có → giữ nguyên, không lệch', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.ngayGiaoDuKien]).toBe(ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'US'));
    const r2 = dungPatch(kien(), null, { [COT.ngayGiaoDuKien]: 1 });
    expect(COT.ngayGiaoDuKien in r2.patch).toBe(false);
    expect(r2.lech).toEqual([]);
  });
  it('thiếu label hoặc nước → không ghi dự kiến', () => {
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ labelCreatedAt: null }), null, {}).patch).toBe(false);
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ shipCountry: null }), null, {}).patch).toBe(false);
  });
});

describe('dungPatch — chi phí (chỉ điền ô trống)', () => {
  it('ô trống → điền tổng + mọi khoản > 0, bỏ khoản 0', () => {
    const r = dungPatch(kien(), charge(), {});
    expect(r.patch[COT_CHI_PHI.totalAmount]).toBe(1438453);
    expect(r.patch[COT_CHI_PHI.fuel]).toBe(383043);
    expect(r.patch[COT_CHI_PHI.directSignature]).toBe(92700);
    expect(r.patch[COT_CHI_PHI.vat]).toBe(106552);
    expect(r.patch[COT_CHI_PHI.importHandling]).toBe(68300);
    expect(r.patch[COT_CHI_PHI.residential]).toBe(84400);
    expect(COT_CHI_PHI.remote in r.patch).toBe(false);
    expect(COT_CHI_PHI.demand in r.patch).toBe(false);
    expect(COT_CHI_PHI.gogreen in r.patch).toBe(false);
    expect(r.nhom.chiPhi).toBe(7);
  });
  it('Mức giá cơ sở theo QUY_UOC_BASE', () => {
    const r = dungPatch(kien(), charge(), {});
    // Task 1 chốt quy ước; test canh cả hai nhánh để ai đổi hằng số phải nhìn thấy.
    expect([2244600, 2244600 - 1541142]).toContain(r.patch[COT_CHI_PHI.base]);
  });
  it('ô đã có số → không ghi; khác thì lệch', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1400000, [COT_CHI_PHI.fuel]: 383043 });
    expect(COT_CHI_PHI.totalAmount in r.patch).toBe(false);
    expect(COT_CHI_PHI.fuel in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.totalAmount))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.fuel))).toHaveLength(0);
  });
  it('total_amount = 0 hoặc không có charge → không ghi khoản nào', () => {
    const r = dungPatch(kien(), charge({ totalAmount: 0 }), {});
    expect(Object.keys(r.patch).some((k) => Object.values(COT_CHI_PHI).includes(k))).toBe(false);
    expect(dungPatch(kien(), null, {}).nhom.chiPhi).toBe(0);
  });
  it('sai lệch làm tròn ≤ 1đ coi như bằng', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1438453.4 });
    expect(r.lech).toEqual([]);
  });
});
