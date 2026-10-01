import { describe, it, expect } from 'vitest';
import { kiemViec, actionMacDinh } from './luat';

const co = {
  monDinhDanh: 'dd', monRecordId: 'recMON', orderNumber: '#MBLVD1', sku: 'A-1',
  lineitemName: 'Áo', store: '#MBLVD', vendor: 'TRACY', soLuong: 1,
  qcCheck: 'QC Pass' as const, whAction: 'Tạm nhập (đi đơn)' as const, lyDoFail: null, warehouse: 'HN | GVM' as const,
};

describe('kiemViec', () => {
  it('dữ liệu đủ → ok', () => {
    const r = kiemViec(co);
    expect(r.ok).toBe(true);
  });
  it('QC Failed thiếu LÝ DO → chặn (lý do gõ ngay đây, bảng không có chỗ bổ sung sau)', () => {
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: null, coAnh: true }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải ghi lý do' });
  });

  /* CEO 01/10/2026: ảnh lỗi "không bắt buộc tại thời điểm này mà có thể bổ sung sau tại bảng
   * Nhận hôm nay". Trước đó thiếu ảnh là chặn lưu — kho đang kiểm mà chưa kịp chụp thì kẹt. */
  it('QC Failed CHƯA có ảnh → VẪN LƯU ĐƯỢC, ảnh bổ sung sau ở bảng', () => {
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: false }).ok).toBe(true);
    expect(kiemViec({ ...co, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bẩn', coAnh: true }).ok).toBe(true);
  });
  it('số lượng phải là số nguyên dương', () => {
    expect(kiemViec({ ...co, soLuong: 0 })).toEqual({ ok: false, loi: 'Số lượng phải lớn hơn 0' });
    expect(kiemViec({ ...co, soLuong: 1.5 })).toEqual({ ok: false, loi: 'Số lượng phải là số nguyên' });
  });
  /* KHÔNG còn luật cân ở đây (CEO 01/10/2026): việc nhận-KCS không mang cân nữa, cân có đúng
   * một chỗ ở `goods_receipt_items.weight_kg` với đúng một trần `CAN_TOI_DA_KG` = 50 kg
   * (features/kho-nhan/can-tu-lark.ts). Trước đây luật này cho tới 100 kg trong khi đường
   * Lark chặn ở 50 — hai trần cho cùng một đại lượng, xem D-179. */
  it('việc trả về KHÔNG có trường cân — cân không còn thuộc việc nhận-KCS', () => {
    const r = kiemViec(co);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.ok ? r.viec : {})).not.toContain('canKg');
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

describe('ảnh lỗi khi sửa món vốn đã không đạt trên Lark', () => {
  const fail = { ...co, qcCheck: 'QC Failed' as const, whAction: 'Gửi trả Vendor (QC fail)' as const, lyDoFail: 'bẩn' };
  it('món Lark vốn đã không đạt → sửa cân không cần chụp lại ảnh', () => {
    expect(kiemViec({ ...fail, coAnh: false, daFailTruoc: true }).ok).toBe(true);
  });
  it('món mới CHUYỂN sang không đạt mà chưa có ảnh → KHÔNG còn chặn (CEO 01/10)', () => {
    expect(kiemViec({ ...fail, coAnh: false, daFailTruoc: false }).ok).toBe(true);
  });
  it('dù đã không đạt từ trước vẫn phải có lý do', () => {
    expect(kiemViec({ ...fail, lyDoFail: null, coAnh: false, daFailTruoc: true }))
      .toEqual({ ok: false, loi: 'Không đạt thì phải ghi lý do' });
  });
});
