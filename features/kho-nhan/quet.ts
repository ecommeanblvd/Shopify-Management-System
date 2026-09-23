/**
 * THUẦN: quét một mã trong màn "Nhận & kiểm hàng" thì làm gì.
 *
 * Nguyên tắc giữ từ hệ tem cũ: KHÔNG đoán. Mã vendor hay chuỗi trần phải ra 'khong_hieu', và
 * mã thuộc đơn khác thì hỏi người dùng chứ không tự nhảy — kho đang dở tay nhập một đơn mà
 * màn tự đổi đơn là mất dữ liệu đang gõ.
 *
 * Đơn có thể mua hai cái giống hệt cùng biến thể (xem `noi-mon-dong-don.ts`) — nếu quét lại
 * mã BIẾN THỂ đó thì `find` (lấy khớp ĐẦU TIÊN) sẽ luôn trả về đúng món đã kiểm rồi, khiến
 * người quét không thể nào chạm tới món thứ hai. Vì vậy `MonDeQuet` phải mang cờ `daXuLy` —
 * ưu tiên món CHƯA xử lý khi có nhiều món cùng khớp; chỉ khi tất cả đã xử lý rồi mới trả về
 * khớp đầu tiên (để quét lại một món đã xong vẫn nhận ra món đó, không báo "không hiểu").
 *
 * Mã DÒNG ĐƠN thì không cần logic này: `lark_mon_don_line_uniq` (migration 0158) là UNIQUE
 * INDEX trên `shopify_line_id`, nên một shopifyLineId chỉ có thể khớp tối đa một món — `find`
 * ở nhánh 'dong' không bao giờ gặp nhiều hơn một kết quả.
 */
import { docMaTem, soIdShopify } from '@/features/receiving/ma-tem';

export interface MonDeQuet {
  dinhDanh: string;
  sku: string | null;
  shopifyLineId: string | null;
  shopifyVariantId: string | null;
  /** Đã kiểm/xử lý xong trong lượt quét này. */
  daXuLy: boolean;
}

export type KetQuaQuet =
  | { loai: 'mo_don'; shopifyOrderId: string }
  | { loai: 'chon_mon'; dinhDanh: string }
  | { loai: 'don_khac'; shopifyOrderId: string }
  | { loai: 'tim_bien_the'; shopifyVariantId: string }
  | { loai: 'khong_hieu'; raw: string };

/**
 * So một id LẤY TỪ DB với khoá ĐỌC TỪ TEM. Hai bên KHÔNG cùng dạng: DB lưu gid đầy đủ
 * ("gid://shopify/LineItem/14593977155752" — đo 23/09/2026: 6225/6225 dòng `lark_mon_don`,
 * 15828/15828 dòng `order_fulfillment_lines`), còn tem chỉ mang số trần ("14593977155752").
 * So thẳng `===` luôn ra false: kho quét đúng cái tem mà chính màn này vừa in ra cũng không
 * chọn được món (review cuối 23/09/2026 Critical 1). Rút số cả hai bên bằng `soIdShopify` —
 * nguồn rút số DUY NHẤT của hệ (features/receiving/ma-tem.ts) — rồi mới so.
 */
function khopId(idTrongDb: string | null, soTrenTem: string): boolean {
  if (!idTrongDb) return false;
  const so = soIdShopify(idTrongDb);
  return so != null && so === soTrenTem;
}

export function xuLyQuet(raw: string, mon: readonly MonDeQuet[]): KetQuaQuet {
  const ma = docMaTem(raw);
  if (!ma || ma.loai === 'mon') return { loai: 'khong_hieu', raw };

  if (ma.loai === 'don') return { loai: 'mo_don', shopifyOrderId: ma.shopifyOrderId };

  if (ma.loai === 'dong') {
    const m = mon.find((x) => khopId(x.shopifyLineId, ma.shopifyLineId));
    if (m) return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
    // Biết là tem hợp lệ nhưng không thuộc đơn đang mở — màn tra đơn của dòng này rồi hỏi.
    return { loai: 'don_khac', shopifyOrderId: '' };
  }

  const khopBienThe = mon.filter((x) => khopId(x.shopifyVariantId, ma.shopifyVariantId));
  if (khopBienThe.length > 0) {
    // Nhiều món cùng biến thể (mua 2 cái giống hệt) → ưu tiên món chưa xử lý, để lần quét
    // sau chạm được món thứ hai thay vì cứ dính mãi vào món đầu tiên đã xong.
    const m = khopBienThe.find((x) => !x.daXuLy) ?? khopBienThe[0];
    return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
  }
  return { loai: 'tim_bien_the', shopifyVariantId: ma.shopifyVariantId };
}
