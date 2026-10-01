/** THUẦN: luật kiểm dữ liệu kho nhập, trước khi đụng tới DB hay Lark. */
import { QC_CHECK, WH_ACTION, WAREHOUSE, type QcCheck, type WhAction, type ViecNhanKcs } from './gia-tri-lark';

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
  if (v.qcCheck === 'QC Failed') {
    if (!v.lyDoFail?.trim()) return { ok: false, loi: 'Không đạt thì phải ghi lý do' };
    /* Ảnh lỗi KHÔNG chặn lưu nữa (CEO 01/10/2026): "không bắt buộc tại thời điểm này mà có thể
     * bổ sung sau tại bảng Nhận hôm nay" — bảng đó đã có cột "Ảnh lỗi QC" với nút thêm.
     * LÝ DO thì VẪN bắt buộc (ở trên): lý do gõ ngay trong form này, bảng không có chỗ bổ sung
     * sau, và một chiếc "không đạt" mà không ai ghi vì sao thì không dùng được để cãi với brand. */
  }
  return {
    ok: true,
    viec: {
      monDinhDanh: v.monDinhDanh, monRecordId: v.monRecordId ?? null, orderNumber: v.orderNumber.trim(),
      sku: v.sku ?? null, lineitemName: v.lineitemName ?? null, store: v.store ?? null, vendor: v.vendor ?? null,
      soLuong: v.soLuong, qcCheck: v.qcCheck as QcCheck, whAction: v.whAction as WhAction,
      lyDoFail: v.lyDoFail?.trim() || null, warehouse: v.warehouse as never,
    },
  };
}
