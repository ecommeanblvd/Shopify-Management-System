import { describe, it, expect } from 'vitest';
import { chuoi, so, ngayISO, chuanHoaTen, ghepBrand, docDongLark, duDeTao, COT } from './lark-don';

describe('đọc ô Lark', () => {
  it('chuoi: nhận chuỗi, số, mảng {text}, bọc {value}', () => {
    expect(chuoi('  a  ')).toBe('a');
    expect(chuoi(123)).toBe('123');
    expect(chuoi([{ text: 'Qatar' }])).toBe('Qatar');
    expect(chuoi({ type: 1, value: [{ text: 'Riyadh' }] })).toBe('Riyadh');
    expect(chuoi('')).toBeNull();
    expect(chuoi(null)).toBeNull();
  });
  it('so: nhận số, chuỗi có ký tự lạ, và dạng {value:[n]} của cột công thức', () => {
    expect(so(1.5)).toBe(1.5);
    expect(so('1.575.177 đ'.replace(/\./g, ''))).toBe(1575177);
    expect(so({ type: 2, value: [345947.875] })).toBe(345947.875);
    expect(so(null)).toBeNull();
  });
  it('ngayISO: epoch mili giây → ngày theo giờ VN, không lùi ngày với ô nhập buổi tối', () => {
    // 1751302800000 = 2025-06-30T17:00:00Z, tức 01/07/2025 giờ VN.
    expect(ngayISO(1751302800000)).toBe('2025-07-01');
    expect(ngayISO(0)).toBeNull();
    expect(ngayISO(null)).toBeNull();
  });
});

describe('ghepBrand', () => {
  const ds = [
    { slug: 'tinh', ten: 'Tinh Atelier' },
    { slug: 'tom-fried', ten: 'Tom Fried' },
    { slug: 'kalisa', ten: 'Kalisa' },
    { slug: 'eegen', ten: 'Eegen' },
  ];
  it('khớp bất kể hoa thường, dấu cách, dấu tiếng Việt', () => {
    expect(ghepBrand('Kalisa', ds)).toBe('kalisa');
    expect(ghepBrand('tom fried', ds)).toBe('tom-fried');
    expect(ghepBrand('TOM FRIED', ds)).toBe('tom-fried');
    expect(ghepBrand('TINH Atelier', ds)).toBe('tinh');
  });
  it('khớp biến thể dài hơn khi chỉ có một ứng viên', () => {
    expect(ghepBrand('EEGEN STUDIO', ds)).toBe('eegen');
  });
  it('KHÔNG đoán khi không chắc — gán nhầm brand là gán nhầm công nợ', () => {
    expect(ghepBrand('Brand Lạ Hoắc', ds)).toBeNull();
    expect(ghepBrand('', ds)).toBeNull();
    expect(ghepBrand(null, ds)).toBeNull();
    // 'TINH Altelier' gõ sai chính tả → không khớp tiền tố, phải trả null chứ không đoán bừa.
    expect(ghepBrand('TINH Altelier', ds)).toBeNull();
  });
  it('chuanHoaTen bỏ dấu và ký tự không phải chữ số', () => {
    expect(chuanHoaTen('Cénes — Studio')).toBe('cenesstudio');
  });
});

describe('docDongLark', () => {
  const f: Record<string, unknown> = {
    [COT.maLark]: '26-INSLG-SV-0751',
    [COT.tracking]: ' 882555 646320 ',
    [COT.carrier]: 'FedEx',
    [COT.ngayGui]: 1751302800000,
    [COT.brand]: [{ text: 'Kalisa' }],
    [COT.nuoc]: { type: 1, value: [{ text: 'Qatar' }] },
    [COT.thanhPho]: [{ text: 'Doha' }],
    [COT.duong]: [{ text: 'street 201' }],
    [COT.khu]: [{ text: 'Al Khaleej' }],
    [COT.can]: 1.1,
    [COT.cuocTinhBrand]: 979527,
    [COT.thuBrand]: { type: 2, value: [1575177.875] },
    [COT.von]: 896136,
  };
  const d = docDongLark('rec1', f);
  it('bóc đúng các trường cốt lõi, mã vận đơn bỏ khoảng trắng', () => {
    expect(d).toMatchObject({
      recordId: 'rec1', maLark: '26-INSLG-SV-0751', trackingNumber: '882555646320',
      carrierKey: 'fedex', ngayGui: '2025-07-01', brandText: 'Kalisa', nuoc: 'QA',
      canKg: 1.1, thuBrandThamKhaoVnd: 1575177.875, vonThamKhaoVnd: 896136,
    });
  });
  it('đổi TÊN NƯỚC của Lark sang mã ISO — engine báo giá chỉ hiểu mã', () => {
    expect(docDongLark('r', { [COT.nuoc]: 'United States' }).nuoc).toBe('US');
    expect(docDongLark('r', { [COT.nuoc]: 'Saudi Arabia' }).nuoc).toBe('SA');
    expect(docDongLark('r', { [COT.nuoc]: 'SA' }).nuoc).toBe('SA');
    expect(docDongLark('r', { [COT.nuoc]: 'Nước Không Có Thật' }).nuoc).toBeNull();
  });
  it('viết tắt riêng của Lark: UAE và China (Mainland)', () => {
    expect(docDongLark('r', { [COT.nuoc]: 'UAE' }).nuoc).toBe('AE');
    expect(docDongLark('r', { [COT.nuoc]: 'China (Mainland)' }).nuoc).toBe('CN');
    // Gõ sai chính tả thì vẫn KHÔNG đoán.
    expect(docDongLark('r', { [COT.nuoc]: 'United Arab Aramex' }).nuoc).toBeNull();
  });
  it('gộp đường và khu thành một dòng địa chỉ', () => {
    expect(d.diaChi).toBe('street 201, Al Khaleej');
  });
  it('tiền trên Lark chỉ để THAM KHẢO, chưa báo giá thì để trống', () => {
    const chua = docDongLark('r', { ...f, [COT.cuocTinhBrand]: '', [COT.thuBrand]: 0 });
    expect(chua.thuBrandThamKhaoVnd).toBeNull();
  });
  it('hãng lạ → carrierKey null chứ không bịa', () => {
    expect(docDongLark('r', { [COT.carrier]: 'Hãng Nào Đó' }).carrierKey).toBeNull();
  });
});

describe('duDeTao', () => {
  const day = { recordId: 'r', maLark: 'x', trackingNumber: '123', carrierKey: 'fedex', ngayGui: '2026-08-01',
    brandText: 'Kalisa', nuoc: 'QA', thanhPho: null, maBuuChinh: null, diaChi: null, soNha: null,
    nguoiNhan: null, dienThoai: null, email: null, canKg: 1, moTaHang: null,
    thuBrandThamKhaoVnd: null, vonThamKhaoVnd: null, trangThaiGiao: null };
  it('đủ dữ liệu → null (được tạo)', () => { expect(duDeTao(day, 'kalisa')).toBeNull(); });
  it('thiếu thứ nào báo đúng thứ đó, không tạo đơn rác', () => {
    expect(duDeTao({ ...day, trackingNumber: null }, 'kalisa')).toBe('chưa có mã vận đơn');
    expect(duDeTao(day, null)).toContain('chưa ghép được brand');
    expect(duDeTao({ ...day, nuoc: null }, 'kalisa')).toBe('không đổi được tên nước sang mã ISO');
    expect(duDeTao({ ...day, canKg: 0 }, 'kalisa')).toBe('thiếu cân');
    expect(duDeTao({ ...day, ngayGui: null }, 'kalisa')).toBe('thiếu ngày gửi');
  });
});
