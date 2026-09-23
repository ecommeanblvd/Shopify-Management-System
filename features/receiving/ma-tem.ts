/**
 * THUẦN: đọc chuỗi trong QR trên tem → loại tem + khoá.
 *
 * Bốn tầng mã (spec §2.2): tem MÓN `WH-00009890` (kho in lúc nhận), tem DÒNG ĐƠN
 * `L:<shopifyLineId>` (brand in lên kiện), tem BIẾN THỂ `V:<shopifyVariantId>`
 * (hàng lưu kho, không gắn đơn) và mã ĐƠN `O:<shopifyOrderId>` (quét mở đơn trên
 * màn). Mỗi tem chỉ mang MỘT khoá; Product / Variant / Order tra từ DB. Không
 * nhận chuỗi trần (không tiền tố) — quét nhầm mã vạch SKU của brand phải ra null
 * chứ không đoán.
 */
export type MaTem =
  | { loai: 'mon'; unitCode: string }
  | { loai: 'dong'; shopifyLineId: string }
  | { loai: 'bien_the'; shopifyVariantId: string }
  | { loai: 'don'; shopifyOrderId: string };

const MON = /^WH-(\d{8})$/i;
// Nhận cả số trần lẫn gid đầy đủ ("gid://shopify/ProductVariant/222") — người dán tay từ
// Shopify ra hay dán nguyên gid, bắt họ cắt chuỗi là mời gọi gõ nhầm. Đã có tiền tố L/V/O:
// rồi nên không cần số tối thiểu 6 chữ số để tránh nhận nhầm chuỗi trần — id demo/test có
// thể ngắn hơn id Shopify thật. Loại tài nguyên trong gid (nhóm 2) được bắt riêng để đối
// chiếu với tiền tố — gid ghi rõ "Order" mà tiền tố là V: là mã tự mâu thuẫn, không được đoán.
const CO_TIEN_TO = /^([LVO]):(?:gid:\/\/shopify\/([A-Za-z]+)\/)?(\d{1,20})$/i;

/** Loại tài nguyên Shopify hợp lệ ứng với từng tiền tố tem. */
const LOAI_GID_THEO_TIEN_TO: Record<'L' | 'V' | 'O', string> = {
  L: 'LineItem',
  V: 'ProductVariant',
  O: 'Order',
};

export function docMaTem(raw: string): MaTem | null {
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;
  const m = MON.exec(s);
  if (m) return { loai: 'mon', unitCode: `WH-${m[1]}` };
  const c = CO_TIEN_TO.exec(s);
  if (!c) return null;
  const tienTo = c[1].toUpperCase() as 'L' | 'V' | 'O';
  const loaiGid = c[2];
  const so = c[3];
  // gid tự khai loại tài nguyên — nếu khác tiền tố thì mã tự mâu thuẫn, từ chối chứ không đoán.
  if (loaiGid && loaiGid.toLowerCase() !== LOAI_GID_THEO_TIEN_TO[tienTo].toLowerCase()) return null;
  switch (tienTo) {
    case 'L': return { loai: 'dong', shopifyLineId: so };
    case 'V': return { loai: 'bien_the', shopifyVariantId: so };
    default: return { loai: 'don', shopifyOrderId: so };
  }
}

/**
 * Số cuối của một gid Shopify ("gid://shopify/Order/999" → "999"); số trần giữ nguyên. Không có
 * chữ số → null.
 *
 * ĐÂY LÀ NƠI DUY NHẤT rút số của một id Shopify trong hệ này — đừng viết regex thứ hai. Tem chỉ
 * mang SỐ TRẦN (`docMaTem` trả về số trần), còn MỌI cột id trong DB đều lưu GID ĐẦY ĐỦ (đo
 * 23/09/2026: `lark_mon_don.shopify_line_id` 6225/6225 gid, `order_fulfillment_lines.shopify_line_id`
 * 15828/15828 gid). So thẳng hai bên là luôn sai (`'gid://…/14593977155752' === '14593977155752'`
 * là false) nên bên nào cầm id từ DB PHẢI rút số qua hàm này trước khi so với khoá đọc từ tem.
 * Phía SQL thì dùng `regexp_replace` cắt mọi thứ tới dấu gạch chéo cuối — cùng một phép rút,
 * chỉ khác nơi chạy.
 */
export function soIdShopify(id: string): string | null {
  const m = /(\d{1,20})$/.exec(id.trim());
  return m ? m[1] : null;
}

/**
 * HAI dạng mà một id Shopify có thể nằm trong DB: gid đầy đủ và số trần.
 *
 * Dùng để SO KHỚP trong SQL mà KHÔNG mất index. Cách viết `regexp_replace(cột, …) = $1` tuy đúng
 * nhưng không sargable: Postgres phải quét sạch bảng rồi mới lọc — đo 23/09/2026 trên
 * `shopify_variants` (120.817 dòng) là 227ms mỗi lượt, chiếm ~95% chi phí một lần quét tem `V:`.
 * So bằng `inArray(cột, cacDangIdShopify(so, 'ProductVariant'))` cho ra hai literal, dùng được
 * index sẵn có, đọc 2.164 buffer thay vì 27.718. Chỉ đổi ở nơi ĐÃ ĐO; chỗ nào bảng nhỏ thì
 * `regexp_replace` vẫn đủ và dễ đọc hơn.
 *
 * Đây cũng là nơi DUY NHẤT ráp chuỗi gid — đừng nối `'gid://shopify/…/' + id` ở chỗ khác.
 */
export function cacDangIdShopify(so: string, loai: 'LineItem' | 'ProductVariant' | 'Order'): string[] {
  return [`gid://shopify/${loai}/${so}`, so];
}

/** Chuỗi in vào mã vạch tem dòng đơn. Id không chứa chữ số (đọc lại được) → null. */
export function maTemDong(shopifyLineId: string): string | null {
  const so = soIdShopify(shopifyLineId);
  return so ? `L:${so}` : null;
}

/** Chuỗi in vào mã vạch tem hàng lưu kho (một loại hàng, không gắn đơn). Id không chứa chữ số → null. */
export function maTemBienThe(shopifyVariantId: string): string | null {
  const so = soIdShopify(shopifyVariantId);
  return so ? `V:${so}` : null;
}

/** Chuỗi mã vạch của cả đơn — quét để mở đơn trên màn. Id không chứa chữ số → null. */
export function maTemDon(shopifyOrderId: string): string | null {
  const so = soIdShopify(shopifyOrderId);
  return so ? `O:${so}` : null;
}
