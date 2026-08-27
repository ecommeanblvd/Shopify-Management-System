import { describe, expect, it } from 'vitest';
import { ghepBangKeVoiHoaDon } from './hnc-bill';
import type { HncManifest } from './hnc-manifest';
import type { VnEInvoice } from './vn-einvoice';

const bangKe = (over: Partial<HncManifest> = {}): HncManifest => ({
  periodStart: '2026-07-25', periodEnd: '2026-08-22',
  customerCode: '0322009749', buyerName: 'CÔNG TY CỔ PHẦN INECSO', buyerTaxCode: '0109894073',
  fxRate: 26310, amountExVat: 1310238, vatPercent: 8, vatAmount: 104819, amountInclVat: 1415057,
  lines: [
    { shipDate: '2026-07-27', hncBill: '893600007901506', trackingNumber: '35278967006', destination: 'UNITED ARAB EMIRATES', kind: 'P', weightKg: 1, baseUsd: 17.4, fuelUsd: 5.22, extraUsd: 0.4, totalUsd: 23.02, totalVnd: 605656 },
    { shipDate: '2026-07-27', hncBill: '893600007901974', trackingNumber: '35278966995', destination: 'SAUDI ARABIA', kind: 'P', weightKg: 1, baseUsd: 20.29, fuelUsd: 6.09, extraUsd: 0.4, totalUsd: 26.78, totalVnd: 704582 },
  ],
  warnings: [],
  ...over,
});

const hoaDon = (over: Partial<VnEInvoice> = {}): VnEInvoice => ({
  billNumber: '00007957', serial: '1K26TMB', issueDate: '2026-08-27', currency: 'VND',
  sellerName: 'CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ', sellerTaxCode: '0305141894',
  buyerName: 'CÔNG TY CỔ PHẦN INECSO', buyerTaxCode: '0109894073',
  amountExVat: 1310238, vatAmount: 104819, amountInclVat: 1415057,
  lines: [
    { trackingNumber: '35278967006', description: 'số vận đơn 35278967006', amountExVat: 605656, discount: 0, vatPercent: 8, vatAmount: 48452, total: 654108 },
    { trackingNumber: '35278966995', description: 'số vận đơn 35278966995', amountExVat: 704582, discount: 0, vatPercent: 8, vatAmount: 56367, total: 760949 },
  ],
  warnings: [],
  ...over,
});

describe('ghepBangKeVoiHoaDon', () => {
  it('số hoá đơn lấy từ hoá đơn — bảng kê không có', () => {
    expect(ghepBangKeVoiHoaDon(bangKe(), hoaDon()).billNumber).toBe('00007957');
  });

  // Bảng kê ghi thẳng kỳ thật (25/07–22/08); suy từ mô tả hoá đơn ra 01/08–31/08 là sai.
  it('kỳ lấy từ bảng kê, không suy từ hoá đơn', () => {
    const b = ghepBangKeVoiHoaDon(bangKe(), hoaDon());
    expect(b.periodStart).toBe('2026-07-25');
    expect(b.periodEnd).toBe('2026-08-22');
  });

  it('ngày lập lấy từ hoá đơn', () => {
    expect(ghepBangKeVoiHoaDon(bangKe(), hoaDon()).issueDate).toBe('2026-08-27');
  });

  it('mỗi dòng có đủ cân nặng, ngày đi hàng và nước đến', () => {
    const l = ghepBangKeVoiHoaDon(bangKe(), hoaDon()).lines[0];
    expect(l).toMatchObject({ trackingNumber: '35278967006', weightKg: 1, shipDate: '2026-07-27' });
    expect(l.note).toContain('UNITED ARAB EMIRATES');
  });

  it('cước gốc và phụ phí xăng dầu quy sang tiền Việt theo tỉ giá của chính kỳ đó', () => {
    const l = ghepBangKeVoiHoaDon(bangKe(), hoaDon()).lines[0];
    expect(l.fuel).toBe(Math.round(5.22 * 26310));
    expect(l.other).toBe(Math.round(0.4 * 26310));
  });

  // Quy đổi từng khoản rồi làm tròn có thể lệch vài đồng so với tổng hãng ghi.
  // Ép cước gốc gánh phần lẻ để cộng ba khoản luôn ra đúng tổng, nếu không UI
  // đối soát sẽ hiện chênh lệch vài đồng ở mọi dòng.
  it('cộng cước gốc + xăng dầu + phát sinh luôn khớp tổng của hãng', () => {
    for (const l of ghepBangKeVoiHoaDon(bangKe(), hoaDon()).lines) {
      expect(l.base! + l.fuel! + l.other!).toBe(l.total);
    }
  });

  it('thuế từng dòng lấy từ hoá đơn theo số vận đơn', () => {
    expect(ghepBangKeVoiHoaDon(bangKe(), hoaDon()).lines[0].vat).toBe(48452);
  });

  it('giữ số tiền gốc bằng đô để tra lại khi cần', () => {
    const c = ghepBangKeVoiHoaDon(bangKe(), hoaDon()).lines[0].charges as Array<{ name: string; usd: number }>;
    expect(c.find((x) => /gốc/i.test(x.name))?.usd).toBe(17.4);
    expect(c.find((x) => /xăng/i.test(x.name))?.usd).toBe(5.22);
  });

  it('tổng bill là số phải trả đã gồm thuế', () => {
    expect(ghepBangKeVoiHoaDon(bangKe(), hoaDon()).amount).toBe(1415057);
  });

  it('không có hoá đơn kèm thì vẫn ghép được, số hoá đơn dùng số tạm theo kỳ', () => {
    const b = ghepBangKeVoiHoaDon(bangKe(), null);
    expect(b.billNumber).toBe('BK-20260725-20260822');
    expect(b.lines[0].vat).toBeNull();
    expect(b.warnings.join(' ')).toMatch(/chưa có hoá đơn/i);
  });

  it('vận đơn có trong hoá đơn mà thiếu ở bảng kê thì cảnh báo, không bỏ im', () => {
    const hd = hoaDon({ lines: [...hoaDon().lines, { trackingNumber: '99999999999', description: 'số vận đơn 99999999999', amountExVat: 100, discount: 0, vatPercent: 8, vatAmount: 8, total: 108 }] });
    expect(ghepBangKeVoiHoaDon(bangKe(), hd).warnings.join(' ')).toMatch(/99999999999/);
  });

  it('số tiền một vận đơn lệch giữa hai file thì cảnh báo kèm số vận đơn', () => {
    const hd = hoaDon();
    hd.lines[0].amountExVat = 999999;
    expect(ghepBangKeVoiHoaDon(bangKe(), hd).warnings.join(' ')).toMatch(/35278967006/);
  });

  it('tổng hai file lệch nhau thì cảnh báo', () => {
    expect(ghepBangKeVoiHoaDon(bangKe({ amountInclVat: 9999999 }), hoaDon()).warnings.join(' ')).toMatch(/tổng/i);
  });

  it('thiếu tỉ giá thì không bịa quy đổi, để trống cước gốc và phụ phí', () => {
    const l = ghepBangKeVoiHoaDon(bangKe({ fxRate: null }), hoaDon()).lines[0];
    expect(l.fuel).toBeNull();
    expect(l.base).toBeNull();
    expect(l.total).toBe(605656);
  });
});

describe('tỉ giá của hoá đơn', () => {
  it('lấy thẳng tỉ giá bảng kê để đối soát dùng đúng số hãng đã tính', () => {
    expect(ghepBangKeVoiHoaDon(bangKe(), hoaDon()).fxRate).toBe(26310);
  });

  it('bảng kê thiếu tỉ giá thì để trống, không lấy tỉ giá tài khoản thay', () => {
    expect(ghepBangKeVoiHoaDon(bangKe({ fxRate: null }), hoaDon()).fxRate).toBeNull();
  });
});
