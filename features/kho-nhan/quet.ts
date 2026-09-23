/**
 * THUẦN: quét một mã trong màn "Nhận & kiểm hàng" thì làm gì.
 *
 * Nguyên tắc giữ từ hệ tem cũ: KHÔNG đoán. Mã vendor hay chuỗi trần phải ra 'khong_hieu', và
 * mã thuộc đơn khác thì hỏi người dùng chứ không tự nhảy — kho đang dở tay nhập một đơn mà
 * màn tự đổi đơn là mất dữ liệu đang gõ.
 */
import { docMaTem } from '@/features/receiving/ma-tem';

export interface MonDeQuet {
  dinhDanh: string;
  sku: string | null;
  shopifyLineId: string | null;
  shopifyVariantId: string | null;
}

export type KetQuaQuet =
  | { loai: 'mo_don'; shopifyOrderId: string }
  | { loai: 'chon_mon'; dinhDanh: string }
  | { loai: 'don_khac'; shopifyOrderId: string }
  | { loai: 'tim_bien_the'; shopifyVariantId: string }
  | { loai: 'khong_hieu'; raw: string };

export function xuLyQuet(raw: string, mon: readonly MonDeQuet[]): KetQuaQuet {
  const ma = docMaTem(raw);
  if (!ma || ma.loai === 'mon') return { loai: 'khong_hieu', raw };

  if (ma.loai === 'don') return { loai: 'mo_don', shopifyOrderId: ma.shopifyOrderId };

  if (ma.loai === 'dong') {
    const m = mon.find((x) => x.shopifyLineId === ma.shopifyLineId);
    if (m) return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
    // Biết là tem hợp lệ nhưng không thuộc đơn đang mở — màn tra đơn của dòng này rồi hỏi.
    return { loai: 'don_khac', shopifyOrderId: '' };
  }

  const m = mon.find((x) => x.shopifyVariantId === ma.shopifyVariantId);
  if (m) return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
  return { loai: 'tim_bien_the', shopifyVariantId: ma.shopifyVariantId };
}
