/** THUẦN: luật kiểm dữ liệu kho nhập, trước khi đụng tới DB hay Lark. */
import { QC_CHECK, WH_ACTION, WAREHOUSE, type QcCheck, type WhAction, type ViecNhanKcs } from './gia-tri-lark';

/** Cân một món vượt mức này là gõ nhầm (cùng ngưỡng parse-pack-row.ts dùng cho kiện). */
const CAN_TOI_DA = 100;

export function actionMacDinh(qc: QcCheck): WhAction {
  if (qc === 'QC Failed') return 'Gửi trả Vendor (QC fail)';
  if (qc === 'Gửi dư') return 'Lưu kho';
  return 'Tạm nhập (đi đơn)';
}

export function kiemViec(v: Partial<ViecNhanKcs> & { coAnh?: boolean; daFailTruoc?: boolean }): { ok: true; viec: ViecNhanKcs } | { ok: false; loi: string } {
  if (!v.orderNumber?.trim()) return { ok: false, loi: 'Thiếu mã đơn' };
  if (!v.monDinhDanh?.trim()) return { ok: false, loi: 'Thiếu món' };
  if (!QC_CHECK.includes(v.qcCheck as QcCheck)) return { ok: false, loi: 'Kết quả kiểm không hợp lệ' };
  if (!WH_ACTION.includes(v.whAction as WhAction)) return { ok: false, loi: 'Hướng xử lý không hợp lệ' };
  if (!WAREHOUSE.includes(v.warehouse as never)) return { ok: false, loi: 'Kho không hợp lệ' };
  if (typeof v.soLuong !== 'number' || v.soLuong <= 0) return { ok: false, loi: 'Số lượng phải lớn hơn 0' };
  if (!Number.isInteger(v.soLuong)) return { ok: false, loi: 'Số lượng phải là số nguyên' };
  if (v.canKg != null && (!(v.canKg > 0) || v.canKg > CAN_TOI_DA)) return { ok: false, loi: 'Cân không hợp lệ' };
  if (v.qcCheck === 'QC Failed') {
    if (!v.lyDoFail?.trim()) return { ok: false, loi: 'Không đạt thì phải ghi lý do' };
    // Ảnh chỉ bắt buộc khi món CHUYỂN sang không đạt. Món trên Lark vốn đã không đạt từ
    // trước (8.858/9.007 dòng có kết quả) thì bắt chụp lại ảnh lỗi cũ là điều không làm được —
    // sửa mỗi cái cân sẽ thành bế tắc.
    if (!v.coAnh && !v.daFailTruoc) return { ok: false, loi: 'Không đạt thì phải có ảnh lỗi' };
  }
  return {
    ok: true,
    viec: {
      monDinhDanh: v.monDinhDanh, monRecordId: v.monRecordId ?? null, orderNumber: v.orderNumber.trim(),
      sku: v.sku ?? null, lineitemName: v.lineitemName ?? null, store: v.store ?? null, vendor: v.vendor ?? null,
      soLuong: v.soLuong, canKg: v.canKg ?? null, qcCheck: v.qcCheck as QcCheck, whAction: v.whAction as WhAction,
      lyDoFail: v.lyDoFail?.trim() || null, warehouse: v.warehouse as never,
    },
  };
}
