/**
 * THUẦN: xin Shopify CDN trả ảnh ở bề rộng cụ thể.
 *
 * `image { url }` của Shopify trả ẢNH GỐC, không phải bản đã thu nhỏ. Nghĩa là
 * khung QC đang tải nguyên bản 3–5MB rồi ép cho vừa khung — nặng vô ích.
 *
 * Nên chia hai đường: khung thường xin bản hẹp cho nhẹ, còn lúc phóng to soi
 * đường may / vết bẩn thì dùng THẲNG URL gốc, vì nó đã là bản nét nhất có.
 * Xin `width` lúc phóng to là tự thu nhỏ ảnh của chính mình.
 *
 * Shopify CDN nhận tham số `width` ngay trên URL ảnh gốc. Chỉ đụng vào URL của
 * chính CDN Shopify — URL lạ thì trả nguyên, vì thêm tham số bừa vào máy chủ
 * khác có thể làm hỏng chữ ký hoặc trả 404.
 */
const CDN = /(^|\.)cdn\.shopify\.com$/;

export function anhChatLuongCao(url: string, rong: number): string {
  try {
    const u = new URL(url);
    if (!CDN.test(u.hostname)) return url;
    // `set` chứ không `append`: URL đã có `width` thì THAY, không nối thêm cái
    // thứ hai (Shopify đọc cái đầu, mình tưởng đã phóng to mà thật ra chưa).
    u.searchParams.set('width', String(rong));
    return u.toString();
  } catch {
    // URL rỗng/méo: trả nguyên để ảnh vẫn hiện như cũ, không nổ giữa màn QC.
    return url;
  }
}
