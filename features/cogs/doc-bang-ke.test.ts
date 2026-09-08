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
    expect(bangKe[0].tiGia).toBeCloseTo(846_737 / (205 - 172.5), 0);
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
  it('một dòng thiếu VND sẵn → dòng đó đổi theo tỉ giá kỳ (Tổng ₫ ÷ (A − B)), dòng khác giữ số sẵn', () => {
    const rows = lv.rows.map((r, i) => (i === 4 ? r.map((c, j) => (j === 9 ? null : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    const b = bangKe[0];
    expect(b.lines[0].tt).toBe(2_717_400);
    const rate = 1_917_970 / (192.5 - 117.5);
    expect(b.lines[1].tt).toBe(Math.round(87.5 * rate));
  });
  it('cột Note ghi nghìn ₫ kiểu "2,717.400" (La Vierge T5) → nhân 1.000', () => {
    const rows = lv.rows.map((r, i) => (i === 3 ? r.map((c, j) => (j === 9 ? '2,717.400' : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    expect(bangKe[0].lines[0]).toMatchObject({ ttVndSan: 2_717_400, tt: 2_717_400 });
  });
  it('cột Note ghi đơn vị lạ (tỉ lệ VND/USD ngoài 15–40 và 15k–40k) → bỏ, đổi theo tỉ giá kỳ', () => {
    const rows = lv.rows.map((r, i) => (i === 3 || i === 4 || i === 9 ? r.map((c, j) => (j === 9 ? '271' : c)) : r));
    const { bangKe } = docWorkbook([{ ...lv, rows }]);
    expect(bangKe[0].lines[0].ttVndSan).toBeUndefined();
    expect(bangKe[0].lines[0].tt).toBe(Math.round(105 * (1_917_970 / 75)));
  });
});
