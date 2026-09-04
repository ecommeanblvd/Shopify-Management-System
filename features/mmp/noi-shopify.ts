/**
 * Khớp biến thể MMP với biến thể trên Shopify theo MÃ BIẾN THỂ.
 *
 * Vì sao không dùng mã cấp sản phẩm: script cũ tra Shopify bằng
 * `sku:<mã sản phẩm>-*`, nhưng ô "mã sản phẩm" của nhiều brand thực ra là SLUG
 * chứ không phải SKU (khảo sát 04/09: montsand 150/150, lalin 36/36,
 * calista 204/228 có mã dạng `aurelie-collared-button-shirt`) → tra ra 0 kết quả.
 * Mã BIẾN THỂ thì luôn là SKU thật, nên khớp theo nó mới đúng.
 *
 * Ngoài ra Shopify của một số brand gắn thêm tiền tố tên brand vào SKU
 * (`Calista-VECLAT13-L-GRA` trong khi MMP gửi `VECLAT13-L-GRA`), nên sau khi
 * khớp tuyệt đối thất bại thì thử khớp phần ĐUÔI.
 */

export interface BienTheSms { id: string; sku: string }
export interface BienTheShopify { id: string; sku: string; productId: string }

export type KieuKhop = 'chinh_xac' | 'bo_tien_to' | 'khong_khop' | 'nhap_nhang';

export interface KetQuaKhop {
  smsId: string;
  smsSku: string;
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
  kieu: KieuKhop;
}

const chuan = (s: string) => s.trim().toUpperCase();

/**
 * THUẦN. Khớp lần lượt: (1) mã trùng khít; (2) mã Shopify là mã MMP có thêm
 * tiền tố (`X-` + mã MMP) hoặc ngược lại.
 *
 * Nhiều biến thể Shopify cùng khớp đuôi một mã → trả 'nhap_nhang' và KHÔNG nối:
 * nối nhầm biến thể là gán sai tồn kho và sai giá, tệ hơn là để trống.
 */
export function khopBienThe(sms: BienTheSms[], shopify: BienTheShopify[]): KetQuaKhop[] {
  const theoSkuChinhXac = new Map<string, BienTheShopify[]>();
  for (const v of shopify) {
    const k = chuan(v.sku);
    const l = theoSkuChinhXac.get(k) ?? [];
    l.push(v);
    theoSkuChinhXac.set(k, l);
  }

  return sms.map((s): KetQuaKhop => {
    const k = chuan(s.sku);
    const chinhXac = theoSkuChinhXac.get(k) ?? [];
    if (chinhXac.length === 1) {
      return { smsId: s.id, smsSku: s.sku, shopifyVariantId: chinhXac[0].id, shopifyProductId: chinhXac[0].productId, kieu: 'chinh_xac' };
    }
    if (chinhXac.length > 1) {
      return { smsId: s.id, smsSku: s.sku, shopifyVariantId: null, shopifyProductId: null, kieu: 'nhap_nhang' };
    }
    // Khớp đuôi: Shopify "Calista-VECLAT13-L-GRA" ↔ MMP "VECLAT13-L-GRA".
    const duoi = shopify.filter((v) => {
      const vk = chuan(v.sku);
      return vk.endsWith(`-${k}`) || k.endsWith(`-${vk}`);
    });
    if (duoi.length === 1) {
      return { smsId: s.id, smsSku: s.sku, shopifyVariantId: duoi[0].id, shopifyProductId: duoi[0].productId, kieu: 'bo_tien_to' };
    }
    if (duoi.length > 1) {
      return { smsId: s.id, smsSku: s.sku, shopifyVariantId: null, shopifyProductId: null, kieu: 'nhap_nhang' };
    }
    return { smsId: s.id, smsSku: s.sku, shopifyVariantId: null, shopifyProductId: null, kieu: 'khong_khop' };
  });
}

/**
 * Sản phẩm cha để gán cho `mmp_products.shopify_product_id`: sản phẩm Shopify
 * mà ĐA SỐ biến thể khớp về. Nhiều sản phẩm cha khác nhau → trả null (cần
 * người xem), vì gán bừa là nối một sản phẩm MMP vào nhầm sản phẩm Shopify.
 */
export function sanPhamCha(kq: KetQuaKhop[]): string | null {
  const dem = new Map<string, number>();
  for (const k of kq) if (k.shopifyProductId) dem.set(k.shopifyProductId, (dem.get(k.shopifyProductId) ?? 0) + 1);
  if (dem.size === 0) return null;
  if (dem.size > 1) return null;
  return [...dem.keys()][0];
}
