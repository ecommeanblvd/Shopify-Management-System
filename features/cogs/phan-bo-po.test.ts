import { describe, it, expect } from 'vitest';
import { tachSkuDenio, khoaSku, phanBoPO, type DongDon, type DongPO } from './phan-bo-po';

describe('tachSkuDenio / khoaSku', () => {
  it('bundle + packaging: DN0729+PK0729-M-CRE → DN729|M|CRE', () => {
    expect(tachSkuDenio('Denio-DN0729+PK0729-M-CRE')).toEqual({ codes: ['DN729', 'PK729'], size: 'M', colours: ['CRE'] });
    expect(khoaSku('Denio-DN0729+PK0729-M-CRE')).toBe('DN729|M|CRE');
  });
  it('PO ghi rời từng SKU: DN0729-M-CRE và PKDN0729-CRE', () => {
    expect(khoaSku('Denio-DN0729-M-CRE')).toBe('DN729|M|CRE');
    expect(khoaSku('Denio-PKDN0729-CRE')).toBe('PK729||CRE');
  });
  it('bỏ chất liệu PLA và hậu tố -PO/-Sale; hai màu giữ nguyên', () => {
    expect(khoaSku('Denio-DN0774+PKDN0729-S-NALM-PLA-PO')).toBe('DN774|S|NALM');
    expect(khoaSku('Denio-DN0776-M-BBLA-PLA-Sale')).toBe('DN776|M|BBLA');
    expect(khoaSku('Denio-DN0778-M-BBLA&WWHI-PLA')).toBe('DN778|M|BBLA&WWHI');
    expect(khoaSku('Denio-DN0779-Customize-WWHI-PLA')).toBe('DN779|CUSTOMIZE|WWHI');
  });
});

describe('phanBoPO — nhập trước dùng trước, chỉ PO kỳ ≤ tháng đặt (CEO 08/09)', () => {
  const po: DongPO[] = [
    { refCode: '#MBLVDPO03', period: '2026-02', sku: 'Denio-DN0729-M-CRE', qty: 1, amountVnd: 1_794_000 },
    { refCode: '#MBLVDPO05', period: '2026-02', sku: 'Denio-DN0729-M-CRE', qty: 2, amountVnd: 3_400_000 }, // 1.700.000/chiếc
    { refCode: '#MBLVDPO26', period: '2026-05', sku: 'Denio-DN0729-M-CRE', qty: 1, amountVnd: 1_600_000 },
  ];
  const don = (maDon: string, ngay: string, qty = 1, sku = 'Denio-DN0729+PK0729-M-CRE'): DongDon =>
    ({ orderId: `o-${maDon}`, shopifyLineId: `l-${maDon}`, maDon, sku, qty, thangDat: ngay.slice(0, 7), ngayDat: ngay });

  it('đơn đặt trước lấy PO nhập trước; hết PO03 (1 chiếc) chuyển sang PO05', () => {
    const r = phanBoPO([don('#B', '2026-03-10'), don('#A', '2026-02-20')], po);
    expect(r.khong).toEqual([]);
    const a = r.phanBo.find((p) => p.maDon === '#A')!; const b = r.phanBo.find((p) => p.maDon === '#B')!;
    expect(a.tuPO).toEqual([{ refCode: '#MBLVDPO03', period: '2026-02', qty: 1, donGiaVnd: 1_794_000 }]);
    expect(a.amountVnd).toBe(1_794_000);
    expect(b.tuPO[0].refCode).toBe('#MBLVDPO05'); expect(b.amountVnd).toBe(1_700_000);
  });
  it('PO kỳ 05 KHÔNG được dùng cho đơn đặt tháng 3 (chưa nhập)', () => {
    const r = phanBoPO([don('#A', '2026-03-01', 1), don('#B', '2026-03-02', 1), don('#C', '2026-03-03', 1), don('#D', '2026-03-04', 1)], po);
    // PO02/PO05 kỳ 02 có 3 chiếc → A,B,C; D không được lấy PO26 (kỳ 05)
    expect(r.phanBo.map((p) => p.maDon)).toEqual(['#A', '#B', '#C']);
    expect(r.khong).toEqual([expect.objectContaining({ maDon: '#D', lyDo: 'PO hết số lượng' })]);
  });
  it('đơn tháng 5 được lấy PO26 sau khi kỳ 02 hết', () => {
    const r = phanBoPO([don('#A', '2026-02-05', 3), don('#E', '2026-05-20', 1)], po);
    expect(r.phanBo.find((p) => p.maDon === '#A')!.amountVnd).toBe(1_794_000 + 3_400_000);
    expect(r.phanBo.find((p) => p.maDon === '#E')!.tuPO[0].refCode).toBe('#MBLVDPO26');
  });
  it('SL 2 lấy từ 2 PO → cộng đúng giá từng chiếc; thiếu chiếc thì KHÔNG ghi (hoàn kho)', () => {
    const r = phanBoPO([don('#A', '2026-02-05', 2)], po.slice(0, 1).concat([{ ...po[1], qty: 1, amountVnd: 1_700_000 }]));
    expect(r.phanBo[0].amountVnd).toBe(1_794_000 + 1_700_000);
    const r2 = phanBoPO([don('#A', '2026-02-05', 5)], po);
    expect(r2.phanBo).toEqual([]); expect(r2.khong[0].lyDo).toBe('PO hết số lượng');
  });
  it('SKU không có trong PO / đặt trước kỳ PO đầu / thiếu SKU', () => {
    const r = phanBoPO([don('#X', '2026-02-05', 1, 'Denio-DN0741-L-WHI'), don('#Y', '2026-01-05'), don('#Z', '2026-02-05', 1, null as unknown as string)], po);
    expect(r.khong.map((k) => [k.maDon, k.lyDo])).toEqual([['#Y', 'chưa có PO trước tháng đặt'], ['#X', 'không có SKU trong PO'], ['#Z', 'thiếu SKU']]);
  });
});

describe('khoaSku — brand khác Denio (La Vierge, Happy Clothing, Calista)', () => {
  it('La Vierge: mã hai đoạn FW25-01, bỏ PLA → khớp PO ghi không có PLA', () => {
    expect(khoaSku('LaVierge-FW25-01-S-NBEI-PLA')).toBe('FW25-01|S|NBEI');
    expect(khoaSku('LaVierge-RS25-07-S-CBG')).toBe('RS25-07|S|CBG');
    expect(khoaSku('LaVierge-FW25-01-S-NBEI-PLA')).not.toBe(khoaSku('LaVierge-FW25-01-M-NBEI-PLA'));
  });
  it('Happy Clothing / Calista: một đoạn mã, size Customize hoặc XXS/3XL', () => {
    expect(khoaSku('HappyClothing-VD0176-Customize-PIN')).toBe('VD0176|CUSTOMIZE|PIN');
    expect(khoaSku('Calista-4951002-S-BR&WH')).toBe('4951002|S|BR&WH');
    expect(khoaSku('Calista-VD0241-3XL-BBLA&KFGK-PLA')).toBe('VD0241|3XL|BBLA&KFGK');
  });
  it('Denio vẫn như cũ', () => {
    expect(khoaSku('Denio-DN0729+PK0729-M-CRE')).toBe('DN729|M|CRE');
    expect(khoaSku('Denio-PKDN0729-CRE')).toBe('PK729||CRE');
  });
});
