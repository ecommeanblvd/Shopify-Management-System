import { describe, it, test, expect } from 'vitest';
import {
  kiemNhapDongThung, canhBaoLechCan, dimsDongThungTuCot, kiemBox,
  CAN_KIEN_TOI_DA_KG, NGUONG_CANH_BAO, KICH_THUOC_TOI_DA_CM,
} from './dong-thung';

const nhap = (p: Partial<Parameters<typeof kiemNhapDongThung>[0]> = {}) =>
  kiemNhapDongThung({ hop: 'MEAN-BOX-30x25x20', canKg: '1.2', dai: '', rong: '', cao: '', ...p });

describe('kiemNhapDongThung', () => {
  it('nhận thùng + cân, không bắt nhập kích thước', () => {
    // Nhiều kiện dùng túi, không có kích thước nào để đo — bắt nhập là bắt người ta bịa số.
    const r = nhap();
    expect(r.ok).toBe(true);
    expect(r.sach).toEqual({ hop: 'MEAN-BOX-30x25x20', canKg: 1.2, dai: null, rong: null, cao: null });
  });

  it('nhận dấu phẩy thập phân kiểu Việt', () => {
    expect(nhap({ canKg: '1,25' }).sach?.canKg).toBe(1.25);
  });

  it('BẮT BUỘC có cân — đó là lý do bước này tồn tại', () => {
    expect(nhap({ canKg: '' }).loi).toContain('Chưa cân cả kiện');
    expect(nhap({ canKg: '0' }).ok).toBe(false);
    expect(nhap({ canKg: 'nặng' }).ok).toBe(false);
  });

  it('BẮT BUỘC chọn thùng', () => {
    expect(nhap({ hop: '   ' }).loi).toContain('Chưa chọn thùng đã dùng');
  });

  it('cân vượt trần thì CẢNH BÁO gõ nhầm, không im lặng nhận', () => {
    const r = nhap({ canKg: String(CAN_KIEN_TOI_DA_KG + 1) });
    expect(r.ok).toBe(false);
    expect(r.loi.join(' ')).toContain('gõ nhầm');
  });

  it('đủ ba chiều → hợp lệ, lưu đúng cả ba số', () => {
    expect(nhap({ dai: '30', rong: '25', cao: '20' }).sach).toMatchObject({ dai: 30, rong: 25, cao: 20 });
  });

  it('thiếu dài hoặc rộng → vẫn là lỗi, có hay không có cao', () => {
    /* Một chiều lẻ (ngoài cao) không tính được cân quy đổi, mà lưu nửa vời thì màn sau tưởng có dữ liệu. */
    expect(nhap({ dai: '30' }).ok).toBe(false);
    expect(nhap({ rong: '25' }).ok).toBe(false);
    expect(nhap({ dai: '30', cao: '20' }).ok).toBe(false); // thiếu rộng
    expect(nhap({ rong: '25', cao: '20' }).ok).toBe(false); // thiếu dài
  });

  // Túi niêm phong / túi zip trong kho (Túi niêm phong nhỏ 28x42, to 38x52, Túi zip nhỏ
  // 25x35, to 35x45) chỉ có HAI số — không có "cao" để đo. Nới riêng trường hợp này.
  test('dài+rộng, KHÔNG cao → hợp lệ, cao giữ null', () => {
    const r = kiemNhapDongThung({ hop: 'Túi niêm phong nhỏ', canKg: '1', dai: '28', rong: '42', cao: '' });
    expect(r.ok).toBe(true);
    expect(r.sach?.dai).toBe(28);
    expect(r.sach?.rong).toBe(42);
    expect(r.sach?.cao).toBeNull();
  });

  test('chỉ có cao mà thiếu dài hoặc rộng → vẫn là lỗi', () => {
    expect(nhap({ cao: '20' }).ok).toBe(false);
    expect(nhap({ dai: '30', cao: '20' }).ok).toBe(false);
    expect(nhap({ rong: '25', cao: '20' }).ok).toBe(false);
  });

  test('cao = 0 → lỗi, không được coi là "bỏ trống"', () => {
    const r = nhap({ dai: '28', rong: '42', cao: '0' });
    expect(r.ok).toBe(false);
  });

  it('gom HẾT lỗi một lượt, không bắt sửa từng cái một', () => {
    const r = nhap({ hop: '', canKg: '' });
    expect(r.loi.length).toBe(2);
  });
});

describe('canhBaoLechCan — nhắc, KHÔNG chặn', () => {
  it('lệch trong ngưỡng thì im', () => {
    expect(canhBaoLechCan(1.2, 1.1)).toBeNull();
    expect(canhBaoLechCan(1.1, 1.1)).toBeNull();
  });

  it('nặng hơn nhiều thì nhắc gõ nhầm', () => {
    expect(canhBaoLechCan(2, 1)).toContain('Nặng hơn dự kiến 100 %');
  });

  it('nhẹ hơn nhiều thì nhắc THIẾU MÓN — không phải lỗi gõ', () => {
    // Hai chiều lệch có nghĩa khác nhau: nặng hơn là gõ nhầm, nhẹ hơn là có thể sót món.
    expect(canhBaoLechCan(0.4, 1)).toContain('đã đủ món chưa');
  });

  it('không có dự kiến thì không nhắc bừa', () => {
    expect(canhBaoLechCan(1.2, null)).toBeNull();
    expect(canhBaoLechCan(1.2, 0)).toBeNull();
  });

  it('đúng mốc ngưỡng thì chưa nhắc — chỉ nhắc khi VƯỢT', () => {
    expect(canhBaoLechCan(1 + NGUONG_CANH_BAO, 1)).toBeNull();
  });
});

describe('dimsDongThungTuCot — dựng dims để MỞ LẠI bước Đóng thùng', () => {
  it('đủ ba chiều → cả ba', () => {
    expect(dimsDongThungTuCot('30', '25', '20')).toEqual({ l: 30, w: 25, h: 20 });
  });

  it('túi (cao = null trong DB) → vẫn trả dài+rộng, h null — KHÔNG coi là "chưa đóng"', () => {
    // Bug thật đã sửa: điều kiện cũ đòi đủ cả ba cột non-null nên túi → dims null toàn bộ,
    // mất cả dài+rộng đã lưu khi mở lại kiện (kho có 4 cỡ túi — đường đi thường, không hiếm).
    expect(dimsDongThungTuCot('28', '42', null)).toEqual({ l: 28, w: 42, h: null });
  });

  it('thiếu dài hoặc rộng → null (một chiều lẻ không tính được cân quy đổi)', () => {
    expect(dimsDongThungTuCot(null, '42', '10')).toBeNull();
    expect(dimsDongThungTuCot('28', null, '10')).toBeNull();
    expect(dimsDongThungTuCot(null, null, null)).toBeNull();
  });
});

// `kiemBox` tự nó KHÔNG có giá trị mặc định cho `dsTenDaCo` (cố ý — xem ghi chú tại định
// nghĩa trong dong-thung.ts); mặc định `[]` chỉ sống ở đây, trong test helper, để các test
// không kiểm trùng tên không phải lặp lại `[]` ở mọi lời gọi.
const box = (p: Partial<Parameters<typeof kiemBox>[0]> = {}, dsTenDaCo: string[] = []) =>
  kiemBox({ ten: 'Thùng Carton 5kg', daiCm: '40', rongCm: '25', caoCm: '25', ...p }, dsTenDaCo);

describe('kiemBox — kiểm ô nhập của màn quản lý danh mục box (QuanLyBox)', () => {
  it('đủ ba chiều → hợp lệ, trả đúng số đã chuẩn hoá', () => {
    const r = box();
    expect(r.ok).toBe(true);
    expect(r.sach).toEqual({ ten: 'Thùng Carton 5kg', daiCm: 40, rongCm: 25, caoCm: 25 });
  });

  it('BẮT BUỘC có tên', () => {
    expect(box({ ten: '' }).ok).toBe(false);
    expect(box({ ten: '   ' }).loi).toContain('Chưa nhập tên box');
  });

  it('số âm → lỗi', () => {
    expect(box({ daiCm: '-4' }).ok).toBe(false);
    expect(box({ rongCm: '-1' }).ok).toBe(false);
    expect(box({ caoCm: '-10' }).ok).toBe(false);
  });

  it('số 0 → lỗi, không được coi là "bỏ trống"', () => {
    expect(box({ daiCm: '0' }).ok).toBe(false);
    expect(box({ rongCm: '0' }).ok).toBe(false);
    expect(box({ caoCm: '0' }).ok).toBe(false);
  });

  it(`quá KICH_THUOC_TOI_DA_CM (${KICH_THUOC_TOI_DA_CM}) → lỗi`, () => {
    const r = box({ daiCm: String(KICH_THUOC_TOI_DA_CM + 1) });
    expect(r.ok).toBe(false);
    expect(r.loi.join(' ')).toContain(`${KICH_THUOC_TOI_DA_CM} cm`);
  });

  it('trùng tên (so với danh sách tên đã có) → lỗi đọc được bằng tiếng Việt', () => {
    const r = box({}, ['Thùng Carton 5kg', 'Túi FedEx Nhỏ']);
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Tên box này đã có trong danh mục');
  });

  it('KHÔNG trùng tên với chính nó khi nơi gọi đã tự loại tên cũ ra khỏi danh sách', () => {
    // luuBox tự loại tên của box đang sửa trước khi gọi kiemBox — xem features/dong-hang/actions.ts.
    const r = box({ ten: 'Thùng Carton 5kg' }, ['Túi FedEx Nhỏ']);
    expect(r.ok).toBe(true);
  });

  it('dài+rộng, KHÔNG cao → hợp lệ (túi — cao giữ null, không phải 0)', () => {
    const r = box({ caoCm: '' });
    expect(r.ok).toBe(true);
    expect(r.sach?.caoCm).toBeNull();
  });

  it('thiếu dài hoặc rộng → vẫn là lỗi, có hay không có cao', () => {
    expect(box({ daiCm: '' }).ok).toBe(false);
    expect(box({ rongCm: '' }).ok).toBe(false);
    expect(box({ daiCm: '', caoCm: '' }).ok).toBe(false);
    expect(box({ rongCm: '', caoCm: '' }).ok).toBe(false);
  });

  it('gom hết lỗi một lượt', () => {
    const r = box({ ten: '', daiCm: '' });
    expect(r.ok).toBe(false);
    expect(r.loi.length).toBeGreaterThanOrEqual(2);
  });
});
