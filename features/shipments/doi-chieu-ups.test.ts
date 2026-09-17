import { describe, it, expect } from 'vitest';
import { doiChieuUps, coLuatDoiChieuUps } from './doi-chieu-ups';
import type { SuKienQuet } from './doi-chieu-fedex';

const x = (moTa: string): SuKienQuet => ({ eventType: 'X', exceptionCode: 'U1', exceptionDescription: moTa, eventDescription: moTa, date: '2026-08-27T00:00:00Z' });
const i = (moTa: string, type = 'I'): SuKienQuet => ({ eventType: type, eventDescription: moTa, date: '2026-08-26T00:00:00Z' });

describe('doiChieuUps', () => {
  it('khách vắng — xác nhận khi có ngoại lệ tương ứng', () => {
    const r = doiChieuUps('khach_khong_lien_he', [x('The receiver was not available at the time of the final delivery attempt.'), i('Departed')]);
    expect(r.ketQua).toBe('xac_nhan');
    expect(r.bangChung).toContain('not available');
  });
  it('mô tả thường (không phải X) không làm bằng chứng', () => {
    expect(doiChieuUps('thong_quan_ngoai', [i('Clearance in progress'), i('Import Scan')]).ketQua).toBe('khong_thay');
  });
  it('hải quan giữ vì thiếu giấy tờ → không xác nhận, có cảnh báo lỗi nội bộ', () => {
    const r = doiChieuUps('thong_quan_ngoai', [x('A clearance delay has occurred. The commercial invoice is missing.')]);
    expect(r.ketQua).toBe('khong_thay');
    expect(r.canhBao).toContain('lỗi nội bộ');
  });
  it('hải quan giữ không do giấy tờ → xác nhận', () => {
    expect(doiChieuUps('thong_quan_ngoai', [x('Your package is being held by a government agency.')]).ketQua).toBe('xac_nhan');
  });
  it('các lý do khác', () => {
    expect(doiChieuUps('sai_dia_chi_khach', [x('The address is incorrect.')]).ketQua).toBe('xac_nhan');
    expect(doiChieuUps('khach_tu_choi_nhan', [x('The receiver refused the delivery.')]).ketQua).toBe('xac_nhan');
    expect(doiChieuUps('khach_khong_dong_thue', [x('Payment of the duties and taxes is required.')]).ketQua).toBe('xac_nhan');
    expect(doiChieuUps('thien_tai_ha_tang', [x('Severe weather conditions have delayed delivery.')]).ketQua).toBe('xac_nhan');
    expect(doiChieuUps('khach_hen_lai', [x('The receiver requested a future delivery date.')]).ketQua).toBe('xac_nhan');
  });
  it('không gửi hàng: chỉ có nhãn → xác nhận; đã quét → không', () => {
    expect(doiChieuUps('khong_gui_hang', [i('Shipper created a label', 'M')]).ketQua).toBe('xac_nhan');
    const r = doiChieuUps('khong_gui_hang', [i('Pickup Scan', 'P'), i('Shipper created a label', 'M')]);
    expect(r.ketQua).toBe('khong_thay');
    expect(r.canhBao).toContain('đã đi');
  });
  it('lý do không có luật', () => {
    expect(doiChieuUps('hang_cham_khong_ro', []).ketQua).toBe('khong_kiem_duoc');
    expect(coLuatDoiChieuUps('hang_cham_khong_ro')).toBe(false);
    expect(coLuatDoiChieuUps('khach_hen_lai')).toBe(true);
  });
});
