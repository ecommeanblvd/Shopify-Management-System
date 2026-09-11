/**
 * THUẦN: giá THU BRAND cho kiện của store brand riêng (TINH Atelier, Mirer).
 *
 * Vì sao cần (CEO 11/09/2026): hai store này là brand tự bán, nhưng hàng do MEAN gửi.
 * Brand chạy khuyến mãi free ship hay giảm ship cho khách cuối là việc của họ — khi đối
 * soát mình VẪN tính tiền brand. Trước đây báo cáo lấy tiền KHÁCH trả làm doanh thu nên
 * T8/2026 store TINH hiện lỗ 26,4 triệu: khách trả 325.260đ trong khi cước 26.727.031đ.
 *
 * Công thức đúng bằng ca TA1420 CEO đã duyệt 04/09/2026: tính theo bảng giá NGÀY GỬI,
 * gồm cước gốc + xăng dầu tuần đó + phụ phí + VAT. Dựng lại đúng 1.149.852đ.
 * KHÔNG cộng phí đóng gói và KHÔNG cộng markup — đó là mức "thu đúng chi phí".
 */
export const STORE_THU_BRAND: Record<string, string> = {
  'tinhatelier.myshopify.com': 'tinh',
  'mirermirer-official.myshopify.com': 'mirer',
};

export const laStoreThuBrand = (shopDomain: string | null | undefined): boolean =>
  Boolean(shopDomain && shopDomain in STORE_THU_BRAND);

export const brandCuaStore = (shopDomain: string): string | null => STORE_THU_BRAND[shopDomain] ?? null;

export interface PhanGiaKien {
  /** Cước gốc + phụ phí + xăng dầu + VAT, theo bảng giá NGÀY GỬI. */
  carrierCost: number;
  /** Markup của bảng giá, chỉ để tham chiếu — KHÔNG cộng vào giá thu brand. */
  markup?: number;
  packaging?: number;
}

/**
 * Giá thu brand cho một kiện. `phanTramThem` cho phép cộng thêm % nếu sau này CEO
 * muốn có biên; mặc định 0 = thu đúng chi phí, khớp ca TA1420.
 */
export function giaThuBrand(b: PhanGiaKien, phanTramThem = 0): number {
  const goc = Math.max(0, Math.round(b.carrierCost));
  return Math.round(goc * (1 + Math.max(0, phanTramThem) / 100));
}

/** Lãi của kiện store brand = giá thu brand − cước carrier thực trả. */
export function laiKienStoreBrand(giaThu: number | null, cuocThuc: number | null): number | null {
  if (giaThu == null || cuocThuc == null) return null;
  return Math.round(giaThu - cuocThuc);
}
