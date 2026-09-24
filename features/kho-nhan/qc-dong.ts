/**
 * THUẦN: đổi `order.lineItems.nodes` thô của Shopify thành dữ liệu màn QC dùng.
 * Tách khỏi phần gọi mạng để test được mà không cần request context.
 */
import { locThuocTinh, type DongThuocTinh, type MetafieldTho } from './thuoc-tinh-shopify';

export interface DongQc {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  tenSanPham: string | null;
  tenBienThe: string | null;
  /** Ảnh biến thể ĐỨNG ĐẦU (đúng màu khách đặt), rồi tới ảnh sản phẩm. */
  anh: string[];
  thuocTinh: DongThuocTinh[];
  soBiCat: number;
}

interface AnhNode { url: string }
interface BienTheTho { id?: string; title?: string; image?: { url?: string } | null }
interface SanPhamTho {
  id?: string; title?: string;
  images?: { nodes?: AnhNode[] } | null;
  metafields?: { nodes?: MetafieldTho[] } | null;
}
export interface DongTho { sku?: string | null; variant?: BienTheTho | null; product?: SanPhamTho | null }

export function dungDongQc(nodes: readonly DongTho[]): DongQc[] {
  return nodes.map((li) => {
    const v = li.variant ?? null;
    const p = li.product ?? null;
    const anhBienThe = v?.image?.url ? [v.image.url] : [];
    const anhSp = (p?.images?.nodes ?? []).map((x) => x.url);
    const loc = locThuocTinh(p?.metafields?.nodes ?? []);
    return {
      sku: li.sku ?? null,
      variantId: v?.id ?? null,
      productId: p?.id ?? null,
      tenSanPham: p?.title ?? null,
      tenBienThe: v?.title ?? null,
      // Ảnh biến thể đứng đầu và KHÔNG lặp lại ở phần ảnh sản phẩm.
      anh: [...anhBienThe, ...anhSp.filter((u) => u !== anhBienThe[0])],
      thuocTinh: loc.hien,
      soBiCat: loc.soBiCat,
    };
  });
}
