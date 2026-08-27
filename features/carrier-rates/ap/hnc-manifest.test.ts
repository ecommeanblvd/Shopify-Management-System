import { describe, expect, it } from 'vitest';
import { parseHncManifestRows, ngayTuSerialExcel, docSo } from './hnc-manifest';

/** Dựng lại đúng hình dạng file thật: tiêu đề rải rác, bảng bắt đầu ở dòng 34. */
const rows = (): unknown[][] => {
  const r: unknown[][] = Array.from({ length: 80 }, () => []);
  r[8] = []; r[8][6] = 'BẢNG KÊ  CƯỚC PHÍ CHUYỂN PHÁT NHANH';
  r[9] = []; r[9][6] = 'Từ ngày: 25/07/2026 đến 22/08/2026';
  r[13] = []; r[13][6] = 'Mã khách hàng:'; r[13][9] = '0322009749';
  r[15] = []; r[15][6] = 'Tên khách hàng:'; r[15][9] = 'CÔNG TY CỔ PHẦN INECSO';
  r[18] = []; r[18][6] = 'Mã số thuế:'; r[18][9] = '0109894073';
  r[34] = []; const h = r[34];
  h[0] = 'STT'; h[4] = 'Ngày'; h[8] = 'Bill HNC'; h[15] = 'Bill quốc tế'; h[17] = 'Nơi đến';
  h[18] = 'Loại'; h[23] = 'Trọng lượng  (kg)'; h[27] = 'Giá (USD)';
  h[29] = 'Phụ phí xăng dầu (USD)'; h[31] = 'Phí phát sinh (USD)';
  h[36] = 'Tổng cước phí (USD)'; h[37] = 'Tổng cước phí (VNĐ)';
  const d = (i: number, ng: number, hnc: string, awb: string, nuoc: string, kg: number, gia: number, fuel: number, ps: number, usd: number, vnd: number) => {
    const x: unknown[] = [];
    x[0] = i; x[4] = ng; x[8] = hnc; x[15] = awb; x[17] = nuoc; x[18] = 'P';
    x[23] = kg; x[27] = gia; x[29] = fuel; x[31] = ps; x[36] = usd; x[37] = vnd;
    return x;
  };
  r[35] = d(1, 46230, '893600007901506', '35278967006', 'UNITED ARAB EMIRATES', 1, 17.4, 5.22, 0.4, 23.02, 605656);
  r[36] = d(2, 46230, '893600007901974', '35278966995', 'SAUDI ARABIA', 1, 20.29, 6.09, 0.4, 26.78, 704582);
  r[37] = []; r[37][0] = 'Cộng'; r[37][27] = 37.69; r[37][36] = 49.8; r[37][37] = 1310238;
  r[40] = []; r[40][25] = 'Tỷ giá:'; r[40][35] = 26310;
  r[42] = []; r[42][25] = 'Tiền thuế GTGT:'; r[42][35] = 104819;
  r[43] = []; r[43][13] = 'Thuế suất thuế GTGT: 8%';
  r[44] = []; r[44][25] = 'Tổng cộng tiền thanh toán'; r[44][35] = 1415057;
  return r;
};

describe('ngayTuSerialExcel', () => {
  it('đổi số ngày của Excel sang ngày thật', () => {
    expect(ngayTuSerialExcel(46230)).toBe('2026-07-27');
    expect(ngayTuSerialExcel(46255)).toBe('2026-08-21');
  });
  it('giá trị rỗng hoặc không phải số thì trả null', () => {
    expect(ngayTuSerialExcel(null)).toBeNull();
    expect(ngayTuSerialExcel('abc')).toBeNull();
  });
  it('nhận cả chuỗi ngày dd/mm/yyyy khi máy xuất ra dạng chữ', () => {
    expect(ngayTuSerialExcel('27/07/2026')).toBe('2026-07-27');
  });
});

// Bảng kê trộn hai kiểu viết số trong cùng một file: USD dùng chấm thập phân,
// VNĐ dùng chấm ngăn nghìn. Đọc sai một kiểu là sai toàn bộ cột đó.
describe('docSo', () => {
  it('số thật của Excel giữ nguyên phần thập phân', () => {
    expect(docSo(17.4)).toBe(17.4);
    expect(docSo(0.4)).toBe(0.4);
  });
  it('chuỗi có chấm THẬP PHÂN không bị hiểu thành ngăn nghìn', () => {
    expect(docSo('17.4')).toBe(17.4);
    expect(docSo('5.22')).toBe(5.22);
  });
  it('chuỗi có chấm NGĂN NGHÌN thì bỏ chấm', () => {
    expect(docSo('605.656')).toBe(605656);
    expect(docSo('39.046.934')).toBe(39046934);
  });
  it('ô rỗng trả null, không trả 0', () => {
    expect(docSo('')).toBeNull();
    expect(docSo(null)).toBeNull();
  });
});

describe('parseHncManifestRows', () => {
  it('đọc kỳ bảng kê từ dòng "Từ ngày … đến …"', () => {
    const m = parseHncManifestRows(rows())!;
    expect(m.periodStart).toBe('2026-07-25');
    expect(m.periodEnd).toBe('2026-08-22');
  });

  it('đọc mã khách hàng, tên và mã số thuế bên mua', () => {
    const m = parseHncManifestRows(rows())!;
    expect(m.customerCode).toBe('0322009749');
    expect(m.buyerName).toContain('INECSO');
    expect(m.buyerTaxCode).toBe('0109894073');
  });

  // Cột nằm rải rác và có ô gộp; dò theo TÊN cột chứ không theo vị trí cố định,
  // để bảng kê tháng sau xê dịch một dòng vẫn đọc được.
  it('dò cột theo tên tiêu đề, không theo vị trí cố định', () => {
    const r = rows();
    r.splice(0, 0, [], []); // đẩy toàn bộ xuống 2 dòng
    const m = parseHncManifestRows(r)!;
    expect(m.lines).toHaveLength(2);
    expect(m.lines[0].trackingNumber).toBe('35278967006');
  });

  it('mỗi vận đơn có đủ ngày gửi, nước đến, cân, và các khoản tiền', () => {
    const m = parseHncManifestRows(rows())!;
    expect(m.lines[0]).toMatchObject({
      shipDate: '2026-07-27',
      hncBill: '893600007901506',
      trackingNumber: '35278967006',
      destination: 'UNITED ARAB EMIRATES',
      weightKg: 1,
      baseUsd: 17.4,
      fuelUsd: 5.22,
      extraUsd: 0.4,
      totalUsd: 23.02,
      totalVnd: 605656,
    });
  });

  it('đọc tỉ giá, tiền thuế và tổng thanh toán', () => {
    const m = parseHncManifestRows(rows())!;
    expect(m.fxRate).toBe(26310);
    expect(m.vatAmount).toBe(104819);
    expect(m.vatPercent).toBe(8);
    expect(m.amountInclVat).toBe(1415057);
  });

  it('tổng tiền hàng lấy từ dòng Cộng', () => {
    expect(parseHncManifestRows(rows())!.amountExVat).toBe(1310238);
  });

  it('dừng ở dòng "Cộng" — không nhặt dòng chân bảng thành vận đơn', () => {
    expect(parseHncManifestRows(rows())!.lines).toHaveLength(2);
  });

  it('cộng các dòng lệch dòng Cộng thì cảnh báo', () => {
    const r = rows();
    r[37]![37] = 999999;
    expect(parseHncManifestRows(r)!.warnings.join(' ')).toMatch(/lệch/i);
  });

  it('file không phải bảng kê HNC thì trả null', () => {
    expect(parseHncManifestRows([[], ['linh tinh']])).toBeNull();
    expect(parseHncManifestRows([])).toBeNull();
  });
});
