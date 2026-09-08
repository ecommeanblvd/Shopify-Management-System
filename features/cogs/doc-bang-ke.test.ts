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
