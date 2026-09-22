import { describe, it, expect } from 'vitest';
import { kiemViec, actionMacDinh } from './luat';

const co = {
  monDinhDanh: 'dd', monRecordId: 'recMON', orderNumber: '#MBLVD1', sku: 'A-1',
  lineitemName: 'Áo', store: '#MBLVD', vendor: 'TRACY', soLuong: 1, canKg: 1.2,
  qcCheck: 'QC Pass' as const, whAction: 'Tạm nhập (đi đơn)' as const, lyDoFail: null, warehouse: 'HN | GVM' as const,
};

describe('kiemViec', () => {
  it('dữ liệu đủ → ok', () => {
    const r = kiemViec(co);
    expect(r.ok).toBe(true);
  });
  it('QC Failed thiếu lý do hoặc thiếu ảnh → chặn', () => {
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: null, coAnh: true }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải ghi lý do' });
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: false }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải có ảnh lỗi' });
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: true }).ok).toBe(true);
  });
  it('số lượng phải là số nguyên dương', () => {
    expect(kiemViec({ ...co, soLuong: 0 })).toEqual({ ok: false, loi: 'Số lượng phải lớn hơn 0' });
    expect(kiemViec({ ...co, soLuong: 1.5 })).toEqual({ ok: false, loi: 'Số lượng phải là số nguyên' });
  });
  it('cân âm hoặc quá lớn → chặn; bỏ trống thì được', () => {
    expect(kiemViec({ ...co, canKg: -1 })).toEqual({ ok: false, loi: 'Cân không hợp lệ' });
    expect(kiemViec({ ...co, canKg: 200 })).toEqual({ ok: false, loi: 'Cân không hợp lệ' });
    expect(kiemViec({ ...co, canKg: null }).ok).toBe(true);
  });
  it('giá trị lạ ở cột chọn → chặn, KHÔNG để Lark đẻ lựa chọn mới', () => {
    expect(kiemViec({ ...co, qcCheck: 'Pass' as never })).toEqual({ ok: false, loi: 'Kết quả kiểm không hợp lệ' });
    expect(kiemViec({ ...co, whAction: 'Nhập kho' as never })).toEqual({ ok: false, loi: 'Hướng xử lý không hợp lệ' });
    expect(kiemViec({ ...co, warehouse: 'HN' as never })).toEqual({ ok: false, loi: 'Kho không hợp lệ' });
  });
  it('thiếu mã đơn → chặn', () => {
    expect(kiemViec({ ...co, orderNumber: '  ' })).toEqual({ ok: false, loi: 'Thiếu mã đơn' });
  });
});

describe('actionMacDinh', () => {
  it('đạt thì tạm nhập đi đơn (gần 2/3 số dòng), không đạt thì trả vendor', () => {
    expect(actionMacDinh('QC Pass')).toBe('Tạm nhập (đi đơn)');
    expect(actionMacDinh('QC Failed')).toBe('Gửi trả Vendor (QC fail)');
    expect(actionMacDinh('Gửi dư')).toBe('Lưu kho');
  });
});
