import { docMaTem } from '@/features/receiving/ma-tem';

/**
 * THUẦN: diễn giải một chuỗi vừa quét khi đang TẠO ĐƠN KOL — không đụng DB.
 *
 * `V:` chọn thẳng biến thể; `L:` tra ngược biến thể của DÒNG ĐƠN đó (spec CEO
 * 23/09/2026). `WH-` (tem món kho nhận hàng) và `O:` (mã đơn Shopify) đều KHÔNG
 * có nghĩa gì khi tạo đơn KOL — báo rõ thay vì đoán bừa. Chuỗi lạ (mã vạch của
 * brand — hệ thống này KHÔNG lưu mã đó) thì `docMaTem` đã tự trả `null`, giữ
 * nguyên hành vi "không đoán SKU" đó ở đây.
 */
export type KetQuaDienGiaiQuet =
  | { ket: 'bien_the'; shopifyVariantId: string }
  | { ket: 'dong_don'; shopifyLineId: string }
  | { ket: 'khong_ap_dung'; loLoai: 'mon' | 'don' }
  | { ket: 'khong_nhan_dang' };

export function dienGiaiQuetTaoDon(raw: string): KetQuaDienGiaiQuet {
  const ma = docMaTem(raw);
  if (!ma) return { ket: 'khong_nhan_dang' };
  switch (ma.loai) {
    case 'bien_the': return { ket: 'bien_the', shopifyVariantId: ma.shopifyVariantId };
    case 'dong': return { ket: 'dong_don', shopifyLineId: ma.shopifyLineId };
    case 'mon': return { ket: 'khong_ap_dung', loLoai: 'mon' };
    case 'don': return { ket: 'khong_ap_dung', loLoai: 'don' };
  }
}

/** THUẦN: ghép tên sản phẩm + biến thể thành một dòng hiển thị cho picker "Mã hàng". */
export function ghepTenBienThe(tenSanPham: string, tenBienThe: string | null | undefined): string {
  const bt = tenBienThe?.trim();
  return bt ? `${tenSanPham} — ${bt}` : tenSanPham;
}
