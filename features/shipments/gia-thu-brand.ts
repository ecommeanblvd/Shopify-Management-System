/**
 * THUẦN: giá THU BRAND cho kiện của store brand riêng (TINH Atelier, Mirer).
 *
 * Vì sao cần (CEO 11/09/2026): hai store này là brand tự bán, nhưng hàng do MEAN gửi.
 * Brand chạy khuyến mãi free ship hay giảm ship cho khách cuối là việc của họ — khi đối
 * soát mình VẪN tính tiền brand. Trước đây báo cáo lấy tiền KHÁCH trả làm doanh thu nên
 * T8/2026 store TINH hiện lỗ 26,4 triệu: khách trả 325.260đ trong khi cước 26.727.031đ.
 *
 * Công thức (CEO chốt 03/08 cho TA, mở rộng cho Mirer 11/09): **cước carrier trên BILL
 * cộng một khoản cố định 5 USD mỗi ĐƠN** (quy 130.000đ theo tỉ giá 26.000 khớp account
 * FedEx). Đây đúng là con số đang gửi sang MMP ở `features/mmp/order-outbound.ts`, nên
 * báo cáo và đối soát nói cùng một số.
 *
 * Khoản cố định tính MỖI ĐƠN, không phải mỗi kiện: đơn nhiều kiện chỉ cộng một lần.
 *
 * Đo trên toàn bộ lịch sử: cách này thu đủ bù cước và có biên, khác hẳn cách tính theo
 * báo giá ngày gửi (thiếu 56,7tr) hay theo tiền khách cuối trả (âm 543tr vì brand chạy
 * free ship).
 */
export const STORE_THU_BRAND: Record<string, string> = {
  'tinhatelier.myshopify.com': 'tinh',
  'mirermirer-official.myshopify.com': 'mirer',
};

export const laStoreThuBrand = (shopDomain: string | null | undefined): boolean =>
  Boolean(shopDomain && shopDomain in STORE_THU_BRAND);

export const brandCuaStore = (shopDomain: string): string | null => STORE_THU_BRAND[shopDomain] ?? null;

/** Khoản cố định cộng vào mỗi ĐƠN của store brand: 5 USD. */
export const PHI_XU_LY_USD = 5;
export const FX_VND_MOI_USD = 26_000;
export const PHI_XU_LY_VND = PHI_XU_LY_USD * FX_VND_MOI_USD;

export interface KienStoreBrand {
  /** Cước carrier THỰC trên bill của kiện này (VND). */
  cuocBillVnd: number | null;
  /** Kiện này có phải kiện ĐẦU của đơn không — chỉ kiện đầu chịu phí xử lý. */
  laKienDauCuaDon: boolean;
}

/**
 * Giá thu brand cho một kiện. Chưa có bill → null (chưa định giá được), KHÔNG quy về 0
 * rồi tính thành lỗ.
 */
export function giaThuBrand(k: KienStoreBrand, phiXuLyVnd = PHI_XU_LY_VND): number | null {
  if (k.cuocBillVnd == null || k.cuocBillVnd <= 0) return null;
  return Math.round(k.cuocBillVnd) + (k.laKienDauCuaDon ? Math.round(phiXuLyVnd) : 0);
}

/** Lãi của kiện store brand = giá thu brand − cước carrier thực trả. */
export function laiKienStoreBrand(giaThu: number | null, cuocThuc: number | null): number | null {
  if (giaThu == null || cuocThuc == null) return null;
  return Math.round(giaThu - cuocThuc);
}
