import { describe, it, expect } from 'vitest';
import { docWorkbook, kiemCongThuc } from './doc-bang-ke';

const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
const thucNhan = {
  name: 'T8', rows: [
    [], ['', 'pp', 'pp', 'BẢNG KÊ CÔNG NỢ   Từ ngày 01/08/2026 đến 31/08/2026  Brand: Denio'], [],
    ['A. Đơn thực nhận trong tháng '], HDR,
    ['03/08/2026', '#MBLVD29521', 'Alita … / Customize', 'Denio-DN0785-Customize-NPOT-PLA', 1, '2.190.000 ₫', '35%', '438.000 ₫', '', '1.861.500 ₫', '', '#MBLVD29521Denio-DN0785-Customize-NPOT-PLA1', 'T8', 7],
    ['18/08/2026', '#MBLVD29718', 'Nara …', 'Denio-DN0695-S-CRE', 1, '2.550.000 ₫', '35%', '', '', '1.657.500 ₫', '', '#MBLVD29718Denio-DN0695-S-CRE1', 'T8', 7],
    [], ['B. Đơn return trong tháng '], ['Ngày return', ...HDR.slice(1)],
    ['04/08/2026', '#MBLVD29019', 'Nara …', 'Denio-DN0695-XL-CRE', 1, '2.550.000 ₫', '35%', '', '', '1.657.500 ₫', '', '#MBLVD29019Denio-DN0695-XL-CRE1', 'T8', 6],
    [], ['', '', 'TỔNG (A-B)', '', 90, '197.240.000 ₫', '', '', '', '122.132.000 ₫'], ['', '', 'THUẾ GTGT (8%)', '', '', '', '', '', '', '9.770.560 đ'], ['', '', 'TỔNG THANH TOÁN', '', '', '', '', '', '', '131.902.560 ₫'],
  ],
};
const thucBan = { name: 'T8 bán', rows: [[], ['', '', '', 'BẢNG KÊ CÔNG NỢ   Từ ngày 01/08/2026 đến 31/08/2026  Brand: Denio'], [], ['', 'A. Đơn thực bán trong tháng'], ['Ngày báo đơn', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ báo đơn'], ['03/08/2026', '#MBLVD29816', 'Bliss …', 'Denio-DN0664-M-BRO', 1, '1.980.000 ₫', '40%', '', '', '', '', '#MBLVD29816Denio-DN0664-M-BRO1', 8]] };
const nhap = { name: 'Trang tính14', rows: [['Ngày giao', 'Mã đơn hàng', 'Mã SP'], ['14/5', '#MBLVDPO24', 'Denio-DN0815-M-WCCM-PLA']] };

describe('docWorkbook', () => {
  it('nhận tab thực nhận: kỳ, brand, dòng A và B; bỏ tab thực bán và tab nháp có lý do', () => {
    const { bangKe, boQua } = docWorkbook([thucNhan, thucBan, nhap]);
    expect(bangKe).toHaveLength(1);
    const b = bangKe[0];
    expect(b).toMatchObject({ brand: 'Denio', period: '2026-08', tuNgay: '01/08/2026', denNgay: '31/08/2026', sheet: 'T8' });
    expect(b.lines).toHaveLength(2); expect(b.returns).toHaveLength(1);
    expect(b.lines[0]).toMatchObject({ maDon: '#MBLVD29521', sku: 'Denio-DN0785-Customize-NPOT-PLA', sl: 1, giaNoiDia: 2190000, ck: 0.35, phiCustomize: 438000, tt: 1861500, code: '#MBLVD29521Denio-DN0785-Customize-NPOT-PLA1' });
    expect(b.returns[0]).toMatchObject({ maDon: '#MBLVD29019', tt: 1657500 });
    expect(boQua).toEqual(expect.arrayContaining([expect.stringContaining('T8 bán'), expect.stringContaining('Trang tính14')]));
  });
  it('dòng không đọc được TT → cảnh báo, không đưa vào lines', () => {
    const rows = [...thucNhan.rows]; rows.splice(6, 0, ['05/08/2026', '#MBLVD29999', 'X', 'Denio-DN0001-S-BLA', 1, '1.000.000 ₫', '35%', '', '', 'Insert Price', '', '', 'T8', 7]);
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines.map((l) => l.maDon)).not.toContain('#MBLVD29999');
    expect(bangKe[0].canhBao.some((c) => c.includes('#MBLVD29999'))).toBe(true);
  });
  it('brand đọc từ tiêu đề dù cột tiêu đề là ô merged lặp', () => {
    const rows = thucNhan.rows.map((r, i) => (i === 1 ? ['', 'pp', 'pp', r[3], r[3], r[3]] : r));
    expect(docWorkbook([{ name: 'T8', rows }]).bangKe[0].brand).toBe('Denio');
  });
  it('cột STT thêm vào đầu: ngay/sku/tt vẫn chính xác', () => {
    const rows = thucNhan.rows.map((r, i) =>
      i === 4 ? ['STT', ...HDR] :
      (i > 4 && i < 8) ? [i - 5, ...r] : r
    );
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines[0]).toMatchObject({ ngay: '03/08/2026', sku: 'Denio-DN0785-Customize-NPOT-PLA', tt: 1861500 });
  });
  it('tiêu đề với chữ thường: mã đơn/sku vẫn match', () => {
    const rows = thucNhan.rows.map((r, i) =>
      i === 4 ? HDR.map(h => h.toLowerCase()) : r
    );
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines).toHaveLength(2);
    expect(bangKe[0].lines[0].maDon).toBe('#MBLVD29521');
  });
  it('tiêu đề có cả "Mã đơn hàng" (col 1) và "Mã đơn" (col 2): chọn exact "Mã đơn"', () => {
    const rows = thucNhan.rows.map((r, i) => {
      if (i === 4) return ['Ngày nhận', 'Mã đơn hàng', 'Mã đơn', ...HDR.slice(2)];
      if (i > 4 && i < 8) return [r[0], '', r[1], ...r.slice(2)];
      return r;
    });
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines[0].maDon).toBe('#MBLVD29521');
  });
  it('dòng có Số lượng trống: cảnh báo, không vào lines', () => {
    const rows = [...thucNhan.rows];
    rows.splice(6, 0, ['05/08/2026', '#MBLVD29999', 'X', 'Denio-DN0001-S-BLA', '', '1.000.000 ₫', '35%', '', '', '650.000 ₫', '', '', 'T8', 7]);
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines.map((l) => l.maDon)).not.toContain('#MBLVD29999');
    expect(bangKe[0].canhBao.some((c) => c.includes('#MBLVD29999') && c.includes('Số lượng'))).toBe(true);
  });
});
describe('kiemCongThuc', () => {
  it('TT = giá×SL×(1−CK) + customize (sai số ≤ 1)', () => {
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: 2190000, ck: 0.35, phiCustomize: 438000, tt: 1861500, code: null, hangSheet: 1 })).toBe(true);
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 2, giaNoiDia: 1000000, ck: 0.4, phiCustomize: null, tt: 1200000, code: null, hangSheet: 1 })).toBe(true);
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: 1000000, ck: 0.4, phiCustomize: null, tt: 700000, code: null, hangSheet: 1 })).toBe(false);
  });
  it('thiếu giá hoặc CK → coi là đúng (không có gì để kiểm)', () => {
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: null, ck: null, phiCustomize: null, tt: 250000, code: null, hangSheet: 1 })).toBe(true);
  });
});

describe('docWorkbook — khuôn Happy Clothing (USD, "A. Đơn MEAN thực nhận", "B. Đơn … Global", TỔNG ₫)', () => {
  const HDR_HC = ['Ngày báo', 'Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK HĐ', 'Phí customize', 'Thành tiền', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const hc = {
    name: 'File đối soát T32026 thực nhận', rows: [
      [null, null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/03/2026 đến 31/3/2026\n\nBrand: Happy Clothing'], [],
      [null, 'A. Đơn MEAN thực nhận trong tháng '], HDR_HC,
      ['22/01/2026', '03/03/2026', '#MBLVD27148', 'Sylvia …', 'HappyClothing-VD0176-Customize-PIN', '1', '$935.00', '40%', '$93.50', '$654.50', null, '#MBLVD27148HappyClothing-VD0176-Customize-PIN1', 'T3', '1'],
      ['20/02/2026', '02/03/2026', '#MBLVD27710', 'Samara …', 'HappyClothing-VD0188-M', '1', '$1,080.00', '40%', null, '$648.00', null, '', 'T3', '2'],
      [], ['B. Đơn Happy Clothing Global thực nhận trong tháng '], HDR_HC,
      ['12/02/2026', '02/03/2026', '#HC1340', 'Emily …', 'HappyClothing-VD0104-XS-BLA', '1', '$867.00', '50%', null, '$433.50', null, '', 'T3', '2'],
      [], [null, null, null, 'TỔNG (A)', null, '2', '$2,015.00', null, null, '$1,302.50'], [null, null, null, 'TỔNG (B)', null, '1', '$867.00', null, null, '$433.50'],
      [null, null, null, 'TỔNG (A + B)', null, null, null, null, null, '$1,736.00'], [null, null, null, null, null, null, 'TỔNG THANH TOÁN', null, null, '45,136,000 ₫'],
    ],
  };
  const hcBan = { name: 'File đối soát T32026 thực bán', rows: [[null, null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/03/2026 đến 31/03/2026\n\nBrand: Happy Clothing'], [null, 'A. Đơn MEAN thực nhận '], HDR_HC, ['03/03/2026', '', '#MBLVD28005', 'x', 'HappyClothing-VD0241-3XL', '1', '$1,357.00', '40%', null, null]] };
  it('đọc kỳ 2026-03 (ngày "31/3/2026"), brand đủ tên, B Global vào lines (không phải return), tiền đổi VND theo tỉ giá sheet', () => {
    const { bangKe, boQua } = docWorkbook([hc, hcBan]);
    expect(bangKe).toHaveLength(1);
    const b = bangKe[0];
    expect(b).toMatchObject({ brand: 'Happy Clothing', period: '2026-03', currency: 'VND', tiGia: 26000 }); // 45.136.000 ÷ 1.736
    expect(b.lines).toHaveLength(3); expect(b.returns).toHaveLength(0);
    expect(b.lines[0]).toMatchObject({ maDon: '#MBLVD27148', sku: 'HappyClothing-VD0176-Customize-PIN', ttGoc: 654.5, tt: 17_017_000, giaNoiDia: 935, ck: 0.4, phiCustomize: 93.5 });
    expect(b.lines[2]).toMatchObject({ maDon: '#HC1340', ttGoc: 433.5, tt: 11_271_000 });
    expect(boQua).toEqual([expect.stringContaining('thực bán')]);
  });
  it('kiemCongThuc kiểm trên USD gốc', () => {
    const { bangKe } = docWorkbook([hc]);
    expect(bangKe[0].lines.every(kiemCongThuc)).toBe(true);
  });
  it('sheet USD không có dòng TỔNG ₫ → giữ USD + cảnh báo', () => {
    const rows = hc.rows.filter((r) => !r.some((c) => /TỔNG THANH TOÁN/.test(String(c ?? ''))));
    const { bangKe } = docWorkbook([{ ...hc, rows }]);
    expect(bangKe[0].currency).toBe('USD'); expect(bangKe[0].lines[0].tt).toBe(654.5);
    expect(bangKe[0].canhBao.some((c) => /TỔNG/.test(c))).toBe(true);
  });
});

describe('docWorkbook — khuôn Calista (USD, "TỔNG (A):" ₫, B return, TỔNG THANH TOÁN (A-B))', () => {
  const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK HĐ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán', 'Kỳ báo đơn'];
  const cal = {
    name: ' File đối soát T7 thực nhận ', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/07/2026 đến 31/07/2026\n\nBrand: Calista de Minh Thanh'],
      [null, 'A. Đơn thực nhận trong tháng '], HDR,
      ['02/07/2026', '#MBLVD29184', 'Solstice …', 'Calista-CBAL15-S-WBRI-PLA', '1', '$110.00', '50%', null, null, '$55.00', '1,434,400 ₫', 'x', 'T7', '6'],
      ['06/07/2026', '#MBLVD29180', 'Grace …', 'Calista-4951004-L-NUD', '1', '$300.00', '50%', null, null, '$150.00', '3,912,000 ₫', 'x', 'T7', '6'],
      [null, null, 'TỔNG (A)', null, '2', '$410.00', null, null, null, '$205.00'], [null, null, null, null, null, 'TỔNG (A):', null, null, null, '5,346,400 ₫'],
      [null, 'B. Đơn return trong tháng '], ['Ngày trả', ...HDR.slice(1)],
      ['10/07/2026', '#MBLVD29000', 'Ret …', 'Calista-4951795-L-VAC', '1', '$345.00', '50%', null, null, '$172.50', null, 'x', 'T7', '6'],
      [null, null, 'TỔNG (B)', null, '1', '$345.00', null, null, null, '$172.50'], [null, null, null, null, null, 'TỔNG (B):', null, null, null, '4,499,663 ₫'],
      [null, null, 'TỔNG THANH TOÁN (A-B)', null, null, null, null, null, null, '846,737 đ'],
    ],
  };
  it('tỉ giá = TỔNG (A): ₫ ÷ Σ USD mục A (26.080), return đổi cùng tỉ giá, không cảnh báo cột Ngày trả', () => {
    const { bangKe } = docWorkbook([cal]);
    const b = bangKe[0];
    expect(b).toMatchObject({ brand: 'Calista de Minh Thanh', period: '2026-07', currency: 'VND', tiGia: 26080 });
    expect(b.lines.map((l) => l.tt)).toEqual([1_434_400, 3_912_000]);
    expect(b.returns[0]).toMatchObject({ maDon: '#MBLVD29000', ttGoc: 172.5, tt: 4_498_800 });
    expect(b.canhBao).toEqual([]);
  });
  it('không có "TỔNG (A):" → dùng TỔNG THANH TOÁN (A-B) ÷ (Σ A − Σ return)', () => {
    const rows = cal.rows.filter((r) => !r.some((c) => /^TỔNG \([AB]\):$/.test(String(c ?? ''))));
    const { bangKe } = docWorkbook([{ ...cal, rows }]);
    // Dòng A giữ VND sẵn (Note); return thiếu Note → đổi theo dòng TỔNG THANH TOÁN (A-B) ÷ (Σ A − Σ return) = 26.053.
    const b = bangKe[0];
    expect(b.lines.map((l) => l.tt)).toEqual([1_434_400, 3_912_000]);
    expect(b.returns[0].tt).toBe(Math.round(172.5 * (846_737 / (205 - 172.5))));
  });
});

describe('docWorkbook — khuôn La Vierge (USD + VND từng dòng ở cột Note)', () => {
  const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const lv = {
    name: 'File đối soát T8', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: La Vierge'],
      [null, 'A. Đơn thực nhận trong tháng '], HDR,
      ['06/08/2026', '#MBLVD29627', 'Venetian …', 'LaVierge-FW25-01-S-NBEI-PLA', '1', '$210.00', '50%', null, '$105.00', '2,717,400', 'x', 'T8', '7'],
      ['04/08/2026', '#MBLVD29604', 'Elizabeth …', 'LaVierge-FW25-03-M-NALM-PLA', '1', '$175.00', '50%', null, '$87.50', '2,264,500', 'x', 'T8', '7'],
      [null, null, 'TỔNG THANH TOÁN (A)', null, '2', '$385.00', null, null, '$192.50'], [null, null, null, null, null, 'TỔNG THANH TOÁN (B):', null, null, '4,981,900 ₫'],
      [null, 'B. Đơn return trong tháng '], ['Ngày return', ...HDR.slice(1)],
      ['10/08/2026', '#MBLVD29000', 'Ret …', 'LaVierge-FW25-02-S-BLA', '1', '$235.00', '50%', null, '$117.50', '3,063,930', 'x', 'T8', '7'],
      [null, null, 'TỔNG THANH TOÁN  (A-B)', null, null, null, null, null, '1,917,970 ₫'], [null, null, 'Tổng', null, null, null, null, null, '1,917,970 ₫'],
    ],
  };
  it('mọi dòng có VND sẵn → tt lấy đúng số cột Note, ttGoc giữ USD, tỉ giá suy ra ≈ 25.880', () => {
    const { bangKe } = docWorkbook([lv]);
    const b = bangKe[0];
    expect(b.currency).toBe('VND');
    expect(b.lines.map((l) => l.tt)).toEqual([2_717_400, 2_264_500]);
    expect(b.lines[0]).toMatchObject({ ttGoc: 105, ttVndSan: 2_717_400 });
    expect(b.returns[0]).toMatchObject({ tt: 3_063_930, ttGoc: 117.5 });
    expect(b.tiGia).toBeCloseTo((2_717_400 + 2_264_500 + 3_063_930) / (105 + 87.5 + 117.5), 0);
  });
  it('một dòng thiếu VND sẵn → đổi theo tỉ giá suy từ các dòng mục A có VND sẵn (không lấy return kỳ cũ)', () => {
    const rows = lv.rows.map((r, i) => (i === 4 ? r.map((c, j) => (j === 9 ? null : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    const b = bangKe[0];
    expect(b.lines[0].tt).toBe(2_717_400);
    expect(b.lines[1].tt).toBe(Math.round(87.5 * (2_717_400 / 105))); // 2.264.500 — đúng số sheet
  });
  it('cột Note ghi nghìn ₫ kiểu "2,717.400" (La Vierge T5) → nhân 1.000', () => {
    const rows = lv.rows.map((r, i) => (i === 3 ? r.map((c, j) => (j === 9 ? '2,717.400' : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    expect(bangKe[0].lines[0]).toMatchObject({ ttVndSan: 2_717_400, tt: 2_717_400 });
  });
  it('cột Note ghi đơn vị lạ (tỉ lệ VND/USD ngoài 15–40 và 15k–40k) → bỏ, đổi theo tỉ giá từ dòng TỔNG ₫ mục A (trước mục B)', () => {
    const rows = lv.rows.map((r, i) => (i === 3 || i === 4 || i === 9 ? r.map((c, j) => (j === 9 ? '271' : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    expect(bangKe[0].lines[0].ttVndSan).toBeUndefined();
    // Dòng ₫ đầu tiên trước mục B (4.981.900, nhãn "(B):" sai) là tổng mục A → 4.981.900 ÷ 192,5 = 25.880 → 105 × 25.880
    expect(bangKe[0].lines[0].tt).toBe(2_717_400);
  });
});

describe('docWorkbook — khuôn Linh Phùng (một tab hai mục: A USD có VND sẵn, B VNĐ)', () => {
  const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const lp = {
    name: ' File đối soát T82026', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: Linh Phùng'],
      [null, 'A. Đơn thực nhận trong tháng (USD)'], HDR,
      ['12/08/2026', '#MBLVD29887', 'Lyssandra …', 'LinhPhung-LP-PF-14-M-KILA-PLA', '1', '$474.00', '50%', null, '$237.00', '5,679,222', 'x', 'T8', '8'],
      ['12/08/2026', '#MBLVD29876', 'Helia …', 'LinhPhung-LP-PF24-05-XS-LYE', '1', '$456.00', '50%', null, '$228.00', null, 'x', 'T8', '8'],
      [null, null, 'TỔNG', null, '2', '$930.00', null, null, '$465.00'], [null, null, null, null, null, 'TỔNG ', null, null, '11,142,778 ₫'],
      [null, 'B. Đơn thực nhận trong tháng (VNĐ)'], HDR,
      ['05/08/2026', '#MBLVD29800', 'Áo …', 'LinhPhung-LP-SS-01-S-WHI', '1', '4,990,000 ₫', '25%', null, '3,742,500 ₫', null, 'x', 'T8', '8'],
      [null, null, 'TỔNG (B)', null, '1', '4,990,000 ₫', null, null, '3,742,500 ₫'],
      [null, null, 'TỔNG THANH TOÁN (A+B)', null, '3', null, null, null, '14,885,278 ₫'], [null, null, 'Tổng', null, null, null, null, null, '14,885,278 ₫'],
    ],
  };
  it('dòng USD có VND sẵn dùng số sẵn; dòng USD thiếu đổi theo tỉ giá suy từ dòng có sẵn; dòng VNĐ mục B giữ nguyên', () => {
    const { bangKe } = docWorkbook([lp]);
    const b = bangKe[0];
    expect(b.currency).toBe('VND'); expect(b.returns).toHaveLength(0); expect(b.lines).toHaveLength(3);
    expect(b.lines[0]).toMatchObject({ tt: 5_679_222, ttGoc: 237 });
    // Dòng thiếu Note đổi theo dòng "TỔNG " ₫ mục A ÷ Σ USD mục A (11.142.778 ÷ 465 = 23.963), không suy từ dòng Note.
    const kyVong = Math.round(228 * (11_142_778 / 465));
    expect(b.lines[1].tt).toBe(kyVong);
    expect(b.lines[2]).toMatchObject({ tt: 3_742_500 }); expect(b.lines[2].ttGoc).toBeUndefined();
    expect(b.lines.reduce((s, d) => s + d.tt, 0)).toBe(5_679_222 + kyVong + 3_742_500);
  });
});

describe('docWorkbook — Linh Phùng: cột Note lệch tỉ giá TỔNG (trước VAT) và dòng return lệch cột', () => {
  const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const lp = {
    name: ' File đối soát T82026', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: Linh Phùng'],
      [null, 'A. Đơn thực nhận trong tháng (USD)'], HDR,
      ['12/08/2026', '#MBLVD29887', 'x', 'LinhPhung-LP-PF-14-M-KILA-PLA', '1', '$474.00', '50%', null, '$237.00', '5,679,222', 'x', 'T8', '8'], // 237 × 25.880 ÷ 1,08
      ['12/08/2026', '#MBLVD29876', 'x', 'LinhPhung-LP-PF24-05-XS-LYE', '1', '$456.00', '50%', null, '$228.00', '5,463,556', 'x', 'T8', '8'],
      [null, null, 'TỔNG', null, '2', '$930.00', null, null, '$465.00'], [null, null, null, null, null, 'TỔNG ', null, null, '12,034,200 ₫'], // 465 × 25.880
      [null, 'B. Đơn thực nhận trong tháng (VNĐ)'], HDR,
      ['05/08/2026', '#MBLVD29800', 'x', 'LinhPhung-LP-SS-01-S-WHI', '1', '4,990,000 ₫', '25%', null, '3,742,500 ₫', null, 'x', 'T8', '8'],
      [null, null, 'Tổng', null, null, null, null, null, '15,776,700 ₫'],
    ],
  };
  it('Σ cột Note lệch 8% so dòng TỔNG ₫ → bỏ Note, đổi theo tỉ giá TỔNG (25.880); mục B VNĐ giữ nguyên', () => {
    const { bangKe } = docWorkbook([lp]);
    const b = bangKe[0];
    expect(b.lines.map((d) => d.tt)).toEqual([237 * 25880, 228 * 25880, 3_742_500]);
    expect(b.tiGia).toBe(25880);
    expect(b.canhBao.some((c) => /lệch dòng TỔNG/.test(c))).toBe(true);
  });
  it('dòng return thiếu cột "Giá phụ kiện": Thành tiền lấy ở ô bên trái, có cảnh báo', () => {
    const HDR_B = ['Ngày trả', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
    const t6 = { name: 'File đối soát T62026', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/06/2026 đến 30/06/2026\n\nBrand: Linh Phùng'],
      ['A. Đơn thực nhận trong tháng '], HDR,
      ['02/06/2026', '#MBLVD28800', 'x', 'LinhPhung-LP-A-S-NUD', '1', '5,190,000 ₫', '25%', null, '3,892,500 ₫', null, 'x', 'T6', '5'],
      ['B. Đơn return trong tháng '], HDR_B,
      ['02/06/2026', '#MBLVD28870', 'x', 'LinhPhung-LP-RS24-03-S-NUD', '1', '5,190,000 ₫', '25%', null, '3,892,500 ₫', null, '#MBLVD28870…', 'T6', '5'],
    ] };
    const { bangKe } = docWorkbook([t6]);
    expect(bangKe[0].returns).toHaveLength(1);
    expect(bangKe[0].returns[0]).toMatchObject({ maDon: '#MBLVD28870', tt: 3_892_500 });
    expect(bangKe[0].canhBao.some((c) => /lệch cột/.test(c))).toBe(true);
  });
});

describe('docWorkbook — khuôn Montsand (tiêu đề "BẢNG KÊ ĐƠN HÀNG CẦN THANH TOÁN", mục A/B "phát sinh", tab không có mục A)', () => {
  const HDR = ['Ngáy báo ', 'Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá sản phẩm', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ báo đơn', 'Kỳ thanh toán '];
  const t3 = { name: 'Đơn thực nhận đối soát T3', rows: [
    [null, null, null, null, 'BẢNG KÊ ĐƠN HÀNG CẦN THANH TOÁN\n\nTừ ngày 01/03/2026 đến 31/03/2026\n\nBrand: MONTSAND'],
    ['A. Đơn phát sinh trong tháng (trước 13/02/2026)'], HDR,
    ['10/02/2026', '03/03/2026', '#MBLVD27600', 'x', 'Montsand-VE75-XL-BLU', '1', '17,500,000 ₫', '15%', null, '14,875,000 ₫', null, 'c', '2', 'T3'],
    [null, null, 'TỔNG (A)', null, '1', '17,500,000 ₫', null, null, null, '14,875,000 ₫'],
    ['B. Đơn phát sinh trong tháng (sau 13/02/2026)'], HDR,
    ['20/02/2026', '05/03/2026', '#MBLVD27700', 'y', 'Montsand-D232-S-WHI', '1', '11,660,000 ₫', '50%', null, '5,830,000 ₫', null, 'c', '2', 'T3'],
    [null, null, 'TỔNG (B)', null, '1', '11,660,000 ₫', null, null, null, '5,830,000 ₫'], [null, null, 'TỔNG THANH TOÁN', null, null, null, null, null, null, '22,361,400 ₫'],
  ] };
  const t8 = { name: '  Đơn thực nhận đối soát T8', rows: [
    [null, null, null, null, 'BẢNG KÊ CÔNG NỢ\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: MONTSAND'],
    ['Ngày báo ', ...HDR.slice(1)],
    ['26/06/2026', '25/08/2026', '#MBLVD29333', 'z', 'Montsand-VE75-XL-BLU', '1', '17,500,000 ₫', '50%', null, '8,750,000 ₫', null, 'c', '6', 'T8'],
    [null, null, 'TỔNG ', null, '1', '17,500,000 ₫', null, null, null, '8,750,000 ₫'],
  ] };
  it('T3: tiêu đề khác, A và B "phát sinh" đều cộng, giá đọc từ "Giá sản phẩm"', () => {
    const { bangKe } = docWorkbook([t3]);
    expect(bangKe[0]).toMatchObject({ brand: 'MONTSAND', period: '2026-03' });
    expect(bangKe[0].lines.map((l) => l.tt)).toEqual([14_875_000, 5_830_000]); expect(bangKe[0].returns).toHaveLength(0);
    expect(bangKe[0].lines[0].giaNoiDia).toBe(17_500_000);
  });
  it('T8: không có dòng mục A nhưng tab tên "thực nhận" → cả tab là mục A', () => {
    const { bangKe, boQua } = docWorkbook([t8]);
    expect(boQua).toEqual([]); expect(bangKe[0].lines).toHaveLength(1); expect(bangKe[0].lines[0].tt).toBe(8_750_000);
  });
});

describe('docWorkbook — kỳ brand chưa điền Tổng thành tiền (Keira Tong T8)', () => {
  it('mọi dòng TT = $0.00 → bỏ hết dòng + cảnh báo "chưa hoàn tất"', () => {
    const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'KT', 'Code ', 'Kỳ thanh toán', 'Kỳ báo đơn'];
    const t8 = { name: ' Thực nhận T8', rows: [
      [null, null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: KEIRA TONG'], HDR,
      ['03/08/2026', '#MBLVD29568', 'x', 'KeiraTong-KS06B103328W3-M-WWHI-PLA', '1', '$140.00', '140', null, '$0.00', null, null, 'c', 'T8', '7'],
      ['10/08/2026', '#MBLVD29569', 'y', 'KeiraTong-KS06A003331W1-S-WWHI-PLA', '1', '$248.00', '248', null, '$0.00', null, null, 'c', 'T8', '7'],
      [null, null, 'TỔNG (A)', null, '2', '$388', null, null, '0'],
    ] };
    const { bangKe } = docWorkbook([t8]);
    expect(bangKe[0].lines).toEqual([]);
    expect(bangKe[0].canhBao.some((c) => /chưa hoàn tất/.test(c))).toBe(true);
  });
});

describe('docWorkbook — khuôn Maison des Copains (mục A VND, mục B USD, tab "Bản sao")', () => {
  const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá Global', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const t8 = { name: ' File đối soát T82026', rows: [
    ['sss', null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/08/2026 đến 31/08/2026\n\nBrand: Maison des Copains'],
    ['A. Đơn thực nhận trong tháng '], HDR,
    ['06/08/2026', '#MBLVD29624', 'x', 'MaisonDCP-MDC06DS24S011-SG003-S-LOV', '1', '5,890,000 đ', '25%', null, '4,417,500 đ', null, 'c', 'T8', '7'],
    [null, null, 'TỔNG (A)', null, '1', '5,890,000', null, null, '4,417,500'],
    ['B. Đơn thực nhận trong tháng '], HDR,
    ['10/08/2026', '#MBLVD29700', 'y', 'MaisonDCP-MDC07DS25S005-SW002-S-CRE', '1', '$450', '50%', null, '$225', null, 'c', 'T8', '7'],
    [null, null, 'TỔNG (B)', null, '1', '$450', null, null, '$225'], [null, null, 'TỔNG (B)', null, null, null, null, null, '5,823,000 ₫'],
    [null, null, 'TỔNG THANH TOÁN (A+B)', null, null, null, null, null, '10,240,500 đ'],
  ] };
  const banSao = { ...t8, name: 'Bản sao của File đối soát T8202' };
  it('dòng USD mục B đổi theo (TỔNG THANH TOÁN − phần VND) ÷ USD = 25.880; dòng VND giữ nguyên; giá đọc từ "Giá Global"', () => {
    const { bangKe, boQua } = docWorkbook([t8, banSao]);
    expect(bangKe).toHaveLength(1); expect(boQua).toEqual([expect.stringContaining('bản sao')]);
    const b = bangKe[0];
    expect(b.lines.map((d) => d.tt)).toEqual([4_417_500, 5_823_000]);
    expect(b.lines[0].giaNoiDia).toBe(5_890_000); expect(b.lines[1].ttGoc).toBe(225); expect(b.tiGia).toBe(25880);
  });
});

describe('docWorkbook — Tracy Studio: TỔNG THANH TOÁN gồm VAT, mốc tỉ giá là "TỔNG (A-B)" trước thuế', () => {
  const HDR = ['Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const t7 = { name: 'Đối soát T72026', rows: [
    [null, null, 'BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/07/2026 đến 31/07/2026\n\nBrand: TRACY STUDIO'],
    ['A. Đơn thực nhận trong tháng '], HDR,
    ['#MBLVD29400', 'x', 'Tracy-V1060-L-WHI', '1', '$1,088.00', '50%', null, '$544.00', null, 'c', 'T7', '6'],
    ['#MBLVD29401', 'y', 'Tracy-V1061-M-WHI', '1', '$1,000.00', '50%', null, '$500.00', null, 'c', 'T7', '6'],
    ['B. Đơn return trong tháng '], HDR,
    ['#MBLVD29300', 'z', 'Tracy-V1050-S-WHI', '1', '$800.00', '50%', null, '$400.00', null, 'c', 'T7', '5'],
    [null, null, 'TỔNG (A-B)', null, null, null, null, '16,795,520 đ'], [null, null, 'TỔNG THANH TOÁN', null, null, null, null, '18,139,162 ₫'],
  ] };
  it('tỉ giá = TỔNG (A-B) ₫ ÷ (Σ A − Σ return) = 26.080, không dùng TỔNG THANH TOÁN (×1,08)', () => {
    const { bangKe } = docWorkbook([t7]);
    expect(bangKe[0].tiGia).toBe(26080);
    expect(bangKe[0].lines.map((d) => d.tt)).toEqual([544 * 26080, 500 * 26080]);
    expect(bangKe[0].returns[0].tt).toBe(400 * 26080);
  });
});

describe('docWorkbook — Tracy Studio T6: dòng TỔNG (A) đầu là số đối chiếu (tỉ giá phi lý) → bỏ, lấy dòng TỔNG (A) ₫ thật phía dưới', () => {
  const HDR = ['Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
  const t6 = { name: 'Đối soát T62026', rows: [
    ['BẢNG KÊ CÔNG NỢ \n\nTừ ngày 01/06/2026 đến 30/06/2026\n\nBrand: TRACY STUDIO'],
    ['A. Đơn thực nhận trong tháng ', 'Tỷ giá MEAN', 'MEAN'], HDR,
    ['#MBLVD29131', 'x', 'Tracy-A-V1256-XL-BBLA-PLA', '1', '$1,488.00', '50%', null, '$744.00', null, 'c', 'T6', '6'],
    ['#MBLVD29238', 'y', 'Tracy-V0877-XXL-BLA', '1', '$1,298.00', '50%', null, '$649.00', null, 'c', 'T6', '6'],
    ['Tổng', '36,323,868', '2,905,909', '39,229,777'],
    ['TỔNG (A)', '2', '$2,786.00', '$1,393.00', '20,375,000 ₫', '36,000,000', '-186,270'], // ₫ đầu = số đối chiếu → 20.375.000/1393 = 14.627 ✗
    ['Tỷ giá Vietcombank ngày chốt công nợ (30/06/2026)', '26,076 ₫'],
    ['TỔNG (A)', '36,323,868 đ'], ['THUẾ GTGT (8%) (A*8%)', '2,905,909 ₫'], ['TỔNG THANH TOÁN', '39,229,777 ₫'],
  ] };
  it('tỉ giá 26.076 từ dòng TỔNG (A) 36.323.868 đ; Σ lines = 36.323.868', () => {
    const { bangKe } = docWorkbook([t6]);
    expect(bangKe[0].tiGia).toBe(26076);
    expect(bangKe[0].lines.reduce((s, d) => s + d.tt, 0)).toBe(744 * 26076 + 649 * 26076);
  });
});
