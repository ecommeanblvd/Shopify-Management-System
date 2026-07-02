/**
 * THUẦN (no I/O): quyết định + dựng input để auto tạo product "-Sale" MEAN BLVD
 * cho hàng warehouse return-stock mà bản gốc của brand ĐÃ archived.
 *
 * Orchestrator `create-sale.ts` lo toàn bộ I/O (Shopify / Lark / DB); module này
 * chỉ chứa logic thuần để unit-test.
 *
 * Điều kiện tạo (TẤT CẢ phải đúng — xem `shouldCreateSale`):
 *   1. Có tồn sellable warehouse > 0.
 *   2. KHÔNG phải customize (số đo khách cũ, không tái bán).
 *   3. Bản gốc brand tồn tại trên Shopify VÀ status === 'ARCHIVED' (brand ngừng bán).
 *   4. Dedup: chưa có product MEAN BLVD cho SKU, và chưa có product nào (mọi vendor)
 *      có SKU = base + "-Sale".
 *   5. Lark WH-Inventory hợp lệ (Tồn kho / QC Pass / Lưu kho — xem `larkRowEligible`).
 */
import { normSku } from './meanblvd-sync-logic';

export interface Candidate {
  sku: string;
  base: string;
}

export interface EligibilityInput {
  isCustomize: boolean;
  hasMeanBlvdProduct: boolean;
  hasSaleProduct: boolean;
  originalStatus: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | null;
  larkEligible: boolean;
  sellable: number;
}

/**
 * Quyết định thuần: có nên tạo product -Sale cho SKU này không.
 * Trả ok=false + reason rõ ràng ở lỗi ĐẦU TIÊN gặp; ok=true chỉ khi tất cả pass.
 */
export function shouldCreateSale(e: EligibilityInput): { ok: boolean; reason: string } {
  if (e.isCustomize) return { ok: false, reason: 'customize' };
  if (e.sellable <= 0) return { ok: false, reason: 'no-sellable-stock' };
  if (e.originalStatus == null) return { ok: false, reason: 'original-not-found' };
  if (e.originalStatus !== 'ARCHIVED') {
    return { ok: false, reason: `original-not-archived(${e.originalStatus})` };
  }
  if (e.hasMeanBlvdProduct) return { ok: false, reason: 'meanblvd-product-exists' };
  if (e.hasSaleProduct) return { ok: false, reason: 'sale-product-exists' };
  if (!e.larkEligible) return { ok: false, reason: 'lark-not-eligible' };
  return { ok: true, reason: 'ok' };
}

/**
 * THUẦN: 1 dòng Lark WH-Inventory có đủ điều kiện tái bán không.
 *   Import - Inventory type bắt đầu bằng "Tồn kho" (case-insensitive),
 *   QC Check == "QC Pass" (case-insensitive), WH - Action == "Lưu kho".
 */
export function larkRowEligible(row: {
  inventoryType: string;
  qcCheck: string;
  whAction: string;
}): boolean {
  return (
    /^tồn kho/i.test(row.inventoryType.trim()) &&
    /^qc pass$/i.test(row.qcCheck.trim()) &&
    row.whAction.trim() === 'Lưu kho'
  );
}

export interface OrigVariant {
  sku: string;
  price: string;
  selectedOptions: { name: string; value: string }[];
}

export interface OrigProduct {
  title: string;
  descriptionHtml: string;
  productType: string;
  tags: string[];
  optionNames: string[];
  imageUrls: string[];
}

/**
 * THUẦN: dựng input cho mutation `productSet` từ bản gốc + các variant còn tồn
 * (đã loại customize). Mỗi variant → 1 variant mới với SKU = normBase + '-Sale'.
 *
 *   - vendor 'MEAN BLVD', status 'ACTIVE'
 *   - productOptions: theo optionNames, mỗi option gom các value duy nhất xuất
 *     hiện trong selectedOptions của các variant còn tồn.
 *   - files = imageUrls.map(u => ({ originalSource: u, contentType: 'IMAGE' }))
 *   - variants: [{ optionValues, price, inventoryItem:{ sku: base+'-Sale', tracked:true } }]
 */
export function buildProductSetInput(orig: OrigProduct, variants: OrigVariant[]): unknown {
  // Gom value duy nhất cho mỗi option name, giữ thứ tự xuất hiện.
  const valuesByOption = new Map<string, string[]>();
  for (const name of orig.optionNames) valuesByOption.set(name, []);
  for (const v of variants) {
    for (const opt of v.selectedOptions) {
      const list = valuesByOption.get(opt.name);
      if (list == null) {
        valuesByOption.set(opt.name, [opt.value]);
      } else if (!list.includes(opt.value)) {
        list.push(opt.value);
      }
    }
  }

  const productOptions = Array.from(valuesByOption.entries()).map(([name, values]) => ({
    name,
    values: values.map((value) => ({ name: value })),
  }));

  return {
    title: orig.title,
    descriptionHtml: orig.descriptionHtml,
    productType: orig.productType,
    tags: orig.tags,
    vendor: 'MEAN BLVD',
    status: 'ACTIVE',
    productOptions,
    files: orig.imageUrls.map((u) => ({ originalSource: u, contentType: 'IMAGE' })),
    variants: variants.map((v) => ({
      optionValues: v.selectedOptions.map((o) => ({ optionName: o.name, name: o.value })),
      price: v.price,
      inventoryItem: { sku: `${normSku(v.sku)}-Sale`, tracked: true },
    })),
  };
}
