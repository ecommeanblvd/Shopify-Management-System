/**
 * Chế độ đồng bộ tồn kho Lark → SMS (biến `WH_TON_KHO_LARK`).
 *
 * AN TOÀN LÀ MẶC ĐỊNH, cùng nguyên tắc `docCheDoGhi` (day-lark.ts): chỉ đúng chuỗi dài, lạ
 * `ghi-that` mới ghi thật vào `warehouse_inventory`; biến trống, chưa đặt hay gõ sai đều là
 * CHẠY THỬ (tính kế hoạch, ghi vào nhật ký tác vụ, không đụng tồn). Tồn kho là số có người
 * và đơn hàng đang dựa vào — một lỗi gõ biến không được biến thành điều chỉnh hàng loạt.
 */
export const GHI_THAT_TON_KHO = 'ghi-that';

export function docCheDoTonKho(env: string | undefined): 'dry' | 'ghi' {
  return (env ?? '').trim().toLowerCase() === GHI_THAT_TON_KHO ? 'ghi' : 'dry';
}
