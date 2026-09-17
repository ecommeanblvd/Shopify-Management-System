import { describe, it, expect } from 'vitest';
import { doiChieuFedex, coLuatDoiChieu, type SuKienQuet } from './doi-chieu-fedex';

const e = (eventType: string, exceptionCode: string, exceptionDescription: string): SuKienQuet =>
  ({ eventType, exceptionCode, exceptionDescription, date: '2026-08-12T10:00:00-04:00' });

// Sự kiện lấy nguyên từ FedEx cho các kiện Đức gán lý do sáng 16/09/2026.
const VANG = e('DE', '08', 'Customer not available or business closed');
const DOI_NGAY = e('DE', '17', 'A request was made to change this delivery date.');
const SAI_DC = e('DE', '03', 'Incorrect address');
const KHONG_THU = e('DE', '93', 'Held, unable to collect payment');
const DA_THU = e('DL', '16', 'We received payment during delivery');
const TU_CHOI = e('DE', '07', 'Delivery was refused by the recipient');
const NHA_NK = e('CD', 'R0055', 'Clearance instructions from the importer are required.');
const MO_TA_KEM = e('CD', 'R0142', 'Description provided is insufficient to classify commodity.');
const DANG_TQ = e('CD', 'R0162', 'In clearance process.');
const HAN_CHE = e('IT', '84', 'Your package may be late- local delivery restrictions');
const DEN_MUON = e('DY', '31', 'Package at station, arrived after courier dispatch.');
const CHO_TQ = e('IT', '71', 'Package available for clearance');

describe('doiChieuFedex — khớp đúng ca thật', () => {
  it('không liên hệ được khách: có DE 08 thì xác nhận', () => {
    const r = doiChieuFedex('khach_khong_lien_he', [CHO_TQ, VANG]);
    expect(r.ketQua).toBe('xac_nhan');
    expect(r.bangChung).toContain('Customer not available');
  });
  it('không liên hệ được khách nhưng FedEx chỉ có "chờ thông quan" → không thấy', () => {
    expect(doiChieuFedex('khach_khong_lien_he', [CHO_TQ]).ketQua).toBe('khong_thay');
  });
  it('khách hẹn lại: DE 17 xác nhận', () => {
    expect(doiChieuFedex('khach_hen_lai', [DOI_NGAY]).ketQua).toBe('xac_nhan');
  });
  it('địa chỉ sai: DE 03', () => {
    expect(doiChieuFedex('sai_dia_chi_khach', [VANG, SAI_DC]).ketQua).toBe('xac_nhan');
  });
  it('875653355737: gán "không đóng thuế" nhưng FedEx ghi ĐÃ THU TIỀN khi giao → không thấy', () => {
    expect(doiChieuFedex('khach_khong_dong_thue', [DA_THU, CHO_TQ]).ketQua).toBe('khong_thay');
  });
  it('không đóng thuế: DE 93 xác nhận', () => {
    expect(doiChieuFedex('khach_khong_dong_thue', [DOI_NGAY, KHONG_THU]).ketQua).toBe('xac_nhan');
  });
  it('từ chối nhận: DE 07', () => {
    expect(doiChieuFedex('khach_tu_choi_nhan', [TU_CHOI]).ketQua).toBe('xac_nhan');
  });
  it('thiếu giấy tờ đầu nhập giờ là lỗi nội bộ — không còn luật đối chiếu, không được loại', () => {
    expect(coLuatDoiChieu('thong_quan_thieu_ct_nhap')).toBe(false);
  });
  it('hải quan giữ hàng: sự kiện thông quan chung thì xác nhận', () => {
    expect(doiChieuFedex('thong_quan_ngoai', [DANG_TQ]).ketQua).toBe('xac_nhan');
  });
  it('hải quan giữ vì THIẾU GIẤY TỜ (đầu nhập R0055 hay đầu xuất R0142) → không xác nhận, kèm cảnh báo lỗi nội bộ', () => {
    for (const ev of [NHA_NK, MO_TA_KEM]) {
      const r = doiChieuFedex('thong_quan_ngoai', [ev, CHO_TQ]);
      expect(r.ketQua).toBe('khong_thay');
      expect(r.canhBao).toContain('lỗi nội bộ');
    }
  });
  it('hạ tầng: mã 84 "local delivery restrictions" xác nhận; "đến trạm muộn" thì không', () => {
    expect(doiChieuFedex('thien_tai_ha_tang', [HAN_CHE]).ketQua).toBe('xac_nhan');
    expect(doiChieuFedex('thien_tai_ha_tang', [DEN_MUON]).ketQua).toBe('khong_thay');
  });
  it('không có sự kiện nào → không thấy', () => {
    expect(doiChieuFedex('khach_khong_lien_he', []).ketQua).toBe('khong_thay');
  });
});

describe('coLuatDoiChieu', () => {
  it('chỉ lý do được loại trừ mới cần đối chiếu', () => {
    expect(coLuatDoiChieu('khach_khong_lien_he')).toBe(true);
    expect(coLuatDoiChieu('sai_thong_tin_van_don')).toBe(false);
    expect(coLuatDoiChieu(null)).toBe(false);
  });
});

describe('mọi lý do được loại trừ đều có luật đối chiếu', () => {
  it('không lý do loại trừ nào lọt qua mà không cần bằng chứng', async () => {
    const { LY_DO_CHAM } = await import('./ly-do-cham');
    for (const l of LY_DO_CHAM.filter((x) => x.loaiTruKpi)) expect(coLuatDoiChieu(l.ma), l.ma).toBe(true);
  });
});

describe('laLoiTamThoi — lỗi FedEx nào được thử lại', () => {
  it('lỗi máy chủ là tạm thời; mã vận đơn sai là kết luận', async () => {
    const { laLoiTamThoi } = await import('./doi-chieu-ly-do');
    expect(laLoiTamThoi('INTERNAL.SERVER.ERROR')).toBe(true);
    expect(laLoiTamThoi('SERVICE.UNAVAILABLE.ERROR')).toBe(true);
    expect(laLoiTamThoi('TRACKING.TRACKINGNUMBER.INVALID')).toBe(false);
    expect(laLoiTamThoi('TRACKING.TRACKINGNUMBER.NOTFOUND')).toBe(false);
  });
});

describe('đơn test / huỷ — nhãn chưa từng gửi (CEO 17/09/2026)', () => {
  const OC = { eventType: 'OC', eventDescription: 'Shipment information sent to FedEx', date: '2026-08-11T05:38:58-05:00' };
  const PU = { eventType: 'PU', eventDescription: 'Picked up', date: '2026-08-12T10:00:00-05:00' };

  it('875606002523: chỉ có "Label created" → xác nhận không gửi hàng', () => {
    const r = doiChieuFedex('khong_gui_hang', [OC]);
    expect(r.ketQua).toBe('xac_nhan');
    expect(r.bangChung).toContain('chưa từng quét');
  });
  it('đã có một lần quét lấy hàng là hàng đã đi — không xác nhận, kèm cảnh báo', () => {
    const r = doiChieuFedex('khong_gui_hang', [OC, PU]);
    expect(r.ketQua).toBe('khong_thay');
    expect(r.canhBao).toContain('hàng đã đi');
  });
  it('không có sự kiện nào thì không kết luận được', () => {
    expect(doiChieuFedex('khong_gui_hang', []).ketQua).toBe('khong_thay');
  });
  it('lý do mới có luật đối chiếu', () => {
    expect(coLuatDoiChieu('khong_gui_hang')).toBe(true);
  });
});
