import { describe, it, expect } from 'vitest';
import { chuanHoaMaDon, laMaNgoaiShopify, maGoc, ghepBangKe, type DonTraCuu } from './ghep-line';
import type { DongBangKe } from './doc-bang-ke';

const d = (maDon: string, sku: string, tt: number, sl = 1): DongBangKe => ({ ngay: '01/08/2026', maDon, tenSp: '', sku, sl, giaNoiDia: null, ck: null, phiCustomize: null, tt, code: null, hangSheet: 1 });
const line = (shopifyLineId: string, sku: string, quantity = 1) => ({ orderId: 'o1', storeId: 's1', shopifyLineId, sku, quantity, variantTitle: null });
const don = (maDon: string, lines: ReturnType<typeof line>[]): [string, DonTraCuu] => [maDon, { orderId: 'o1', storeId: 's1', maDon, lines }];

describe('chuẩn hoá', () => {
  it('mã đơn bỏ #, khoảng trắng, hoa', () => { expect(chuanHoaMaDon(' #mblvd29521 ')).toBe('MBLVD29521'); });
  it('mã ngoài Shopify', () => { expect(laMaNgoaiShopify('MBLVDPO24')).toBe(true); expect(laMaNgoaiShopify('MTB1490')).toBe(true); expect(laMaNgoaiShopify('HC1340')).toBe(true); expect(laMaNgoaiShopify('MBLVD29521')).toBe(false); });
  it('mã gốc: bỏ brand, tách +, bỏ tiền tố PK', () => {
    expect(maGoc('Denio-DN0729+PK0729-Customize-CRE')).toEqual(['DN0729', 'PK0729']);
    expect(maGoc('Denio-PKDN0729-CRE')).toEqual(['DN0729']);
    expect(maGoc('Denio-DN0774+PKDN0729-XL-NALM-PLA')).toEqual(['DN0774', 'DN0729']);
    expect(maGoc('Denio-DN0695-S-CRE')).toEqual(['DN0695']);
  });
});
describe('ghepBangKe', () => {
  it('SKU đúng → ghép, cách sku', () => {
    const kq = ghepBangKe([d('#MBLVD1', 'Denio-DN0695-S-CRE', 1657500)], new Map([don('MBLVD1', [line('L1', 'Denio-DN0695-S-CRE')])]));
    expect(kq.theoLine).toHaveLength(1); expect(kq.theoLine[0]).toMatchObject({ amount: 1657500, slSheet: 1, du: false, cachKhop: 'sku' });
  });
  it('váy + phụ kiện trên sheet gộp về một line bundle qua mã gốc', () => {
    const kq = ghepBangKe([d('#MBLVD2', 'Denio-DN0729-Customize-CRE', 1943500), d('#MBLVD2', 'Denio-PKDN0729-CRE', 200000)],
      new Map([don('MBLVD2', [line('L1', 'Denio-DN0729+PK0729-Customize-CRE'), line('L2', 'Denio-DN0695-Customize-CRE')])]));
    expect(kq.theoLine).toHaveLength(1);
    expect(kq.theoLine[0]).toMatchObject({ line: { shopifyLineId: 'L1' }, amount: 2143500, slSheet: 2, du: true, cachKhop: 'ma_goc' });
    expect(kq.khongKhop).toHaveLength(0);
  });
  it('đơn một line → mọi dòng về line đó', () => {
    const kq = ghepBangKe([d('#MBLVD3', 'Denio-XYZ', 100), d('#MBLVD3', 'Denio-ABC', 50)], new Map([don('MBLVD3', [line('L1', 'Denio-KHAC', 2)])]));
    expect(kq.theoLine[0]).toMatchObject({ amount: 150, slSheet: 2, du: false, cachKhop: 'don_mot_line' });
  });
  it('PO / MTB → offline; đơn không có → khong_co_don; nhiều line không phân biệt được → mo_ho', () => {
    const kq = ghepBangKe([d('#MBLVDPO24', 'Denio-DN0815-M', 1374000), d('#MTB1490', 'Denio-DN0001', 1), d('#MBLVD9', 'Denio-DN0001', 1), d('#MBLVD4', 'Denio-DN0729-M-CRE', 1)],
      new Map([don('MBLVD4', [line('L1', 'Denio-DN0729-S-CRE'), line('L2', 'Denio-DN0729-M-BLA')])]));
    expect(kq.offline.map((o) => o.maDon)).toEqual(['#MBLVDPO24', '#MTB1490']);
    expect(kq.khongKhop).toEqual([expect.objectContaining({ lyDo: 'khong_co_don' }), expect.objectContaining({ lyDo: 'mo_ho' })]);
    expect(kq.theoLine).toHaveLength(0);
  });
  it('nhiều ứng viên cùng mã gốc → so size/màu', () => {
    const kq = ghepBangKe([d('#MBLVD5', 'Denio-DN0729-M-CRE', 1)], new Map([don('MBLVD5', [line('L1', 'Denio-DN0729+PK0729-S-CRE'), line('L2', 'Denio-DN0729+PK0729-M-CRE')])]));
    expect(kq.theoLine[0].line.shopifyLineId).toBe('L2');
  });
  it('nhiều line trong đơn, sheet không khớp mã gốc → khong_co_line_khop', () => {
    const kq = ghepBangKe([d('#MBLVD6', 'Denio-DN0999-M-CRE', 1)], new Map([don('MBLVD6', [line('L1', 'Denio-DN0001-S-CRE'), line('L2', 'Denio-DN0002-M-CRE')])]));
    expect(kq.khongKhop).toHaveLength(1);
    expect(kq.khongKhop[0]).toMatchObject({ lyDo: 'khong_co_line_khop' });
    expect(kq.theoLine).toHaveLength(0);
  });
});

describe('ghepBangKe — đơn có nhiều line cùng SKU (Calista #MBLVD26692)', () => {
  const dong = (sku: string, tt: number, sl = 1) => ({ ngay: '', maDon: '#MBLVD26692', tenSp: '', sku, sl, giaNoiDia: null, ck: null, phiCustomize: null, tt, code: null, hangSheet: 1 });
  const don: DonTraCuu = { orderId: 'o1', storeId: 's1', maDon: 'MBLVD26692', lines: [
    { orderId: 'o1', storeId: 's1', shopifyLineId: 'L1', sku: 'Calista-4951002-S-BR&WH', quantity: 1, variantTitle: null },
    { orderId: 'o1', storeId: 's1', shopifyLineId: 'L2', sku: 'MBLVD-Cosmetic-Bag-BL/PK', quantity: 1, variantTitle: null },
    { orderId: 'o1', storeId: 's1', shopifyLineId: 'L3', sku: 'Calista-4951002-S-BR&WH', quantity: 1, variantTitle: null },
  ] };
  const map = new Map([[don.maDon, don]]);
  it('một dòng sheet → gán line đầu cùng SKU, cách sku, không mơ hồ', () => {
    const r = ghepBangKe([dong('Calista-4951002-S-BR&WH', 2_507_700)], map);
    expect(r.khongKhop).toEqual([]);
    expect(r.theoLine).toHaveLength(1); expect(r.theoLine[0].line.shopifyLineId).toBe('L1'); expect(r.theoLine[0].cachKhop).toBe('sku'); expect(r.theoLine[0].du).toBe(false);
  });
  it('hai dòng sheet → hai line, mỗi line một dòng, không dư', () => {
    const r = ghepBangKe([dong('Calista-4951002-S-BR&WH', 2_507_700), dong('Calista-4951002-S-BR&WH', 2_507_700)], map);
    expect(r.theoLine.map((t) => t.line.shopifyLineId).sort()).toEqual(['L1', 'L3']);
    expect(r.theoLine.every((t) => !t.du && t.amount === 2_507_700)).toBe(true);
  });
  it('ba dòng sheet cho hai line → dòng thứ ba dồn về line đầu và báo dư', () => {
    const r = ghepBangKe([1, 2, 3].map(() => dong('Calista-4951002-S-BR&WH', 100)), map);
    const l1 = r.theoLine.find((t) => t.line.shopifyLineId === 'L1')!;
    expect(l1.slSheet).toBe(2); expect(l1.du).toBe(true);
  });
});
