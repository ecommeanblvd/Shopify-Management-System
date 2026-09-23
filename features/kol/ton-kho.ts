import type { MovementDraft } from '@/features/warehouse/ledger';

/**
 * Cầu nối DUY NHẤT từ luồng KOL sang sổ cái tồn kho.
 *
 * Dùng lại bốn lý do sẵn có chứ KHÔNG thêm giá trị enum mới: validateMovement
 * (features/warehouse/allocation-logic.ts) chỉ xét delta và bất biến, hoàn toàn
 * không phân biệt lý do, nên bốn lý do này mang đúng nghĩa cho cả đơn bán lẫn
 * đơn KOL. Phân biệt bằng refType/refId — đúng mục đích hai cột đó sinh ra —
 * và tránh được migration ALTER TYPE ADD VALUE vốn không chạy chung transaction
 * với chỗ dùng nó.
 *
 * Module THUẦN: chỉ dựng MovementDraft rồi trả về, KHÔNG gọi applyMovement,
 * KHÔNG mở transaction, KHÔNG đụng DB — để test được mà không cần DB.
 */
export interface DongCanChuyen { id: string; sku: string; kho: string; soLuong: number }

const REF = 'kol_dong_don' as const;

/** Chốt đơn: giữ chỗ, chưa lấy hàng ra khỏi kho. */
export function draftGiuCho(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: 0, deltaReserved: d.soLuong,
    reason: 'auto_allocate', refType: REF, refId: d.id, actor };
}

/** Huỷ đơn đã chốt hoặc lùi về nháp: trả lại chỗ đã giữ. */
export function draftTraCho(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: 0, deltaReserved: -d.soLuong,
    reason: 'release_allocation', refType: REF, refId: d.id, actor };
}

/** Đã gửi: chỗ đã giữ nay thành hàng đi thật, trừ cả hai con số. */
export function draftXuat(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: -d.soLuong, deltaReserved: -d.soLuong,
    reason: 'pick', refType: REF, refId: d.id, actor };
}

/** Nhận hàng mượn về và còn dùng được: cộng tồn theo SỐ LƯỢNG TRẢ, không phải số đã gửi. */
export function draftNhapLai(d: DongCanChuyen, soLuong: number, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: soLuong, deltaReserved: 0,
    reason: 'receipt_return', refType: REF, refId: d.id, actor };
}
