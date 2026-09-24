import { and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { chonGiaVon } from './gia-von';

/**
 * Tra giá vốn hiện hành cho NHIỀU SKU một lượt, tại một ngày kinh doanh.
 *
 * Phải đi ĐÚNG cùng luật với `traGiaVonHienHanh` trong `actions.ts`, vì con số
 * hiện ở ô tìm sản phẩm chính là con số được ghi vào đơn:
 *  - SKU không quy được về ĐÚNG MỘT cửa hàng → KHÔNG có giá (null), cố ý. Đo
 *    23/09: 110/2.911 SKU rơi vào diện này. Tra `sku_costs` mà bỏ qua store sẽ
 *    hiện giá cho những SKU mà phần còn lại của hệ thống từ chối định giá —
 *    hai nguồn sự thật lệch nhau mà không ai thấy.
 *  - Chọn bản ghi hiệu lực bằng `chonGiaVon` (hàm thuần đã có test), theo NGÀY
 *    KINH DOANH chứ không phải `now()` của Postgres.
 *
 * Hai truy vấn cho cả lô, không phải hai truy vấn mỗi SKU.
 */
export async function traGiaVonNhieuSku(
  skus: readonly string[],
  ngay: string,
): Promise<Map<string, { gia: number; tienTe: string }>> {
  const ket = new Map<string, { gia: number; tienTe: string }>();
  const ds = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  if (ds.length === 0) return ket;

  const bienThe = await db.select({ sku: schema.shopifyVariants.sku, storeId: schema.shopifyVariants.storeId })
    .from(schema.shopifyVariants)
    .where(inArray(schema.shopifyVariants.sku, ds));

  // SKU → store, chỉ giữ SKU thuộc ĐÚNG MỘT store.
  const dem = new Map<string, Set<string>>();
  for (const v of bienThe) {
    if (!v.sku) continue;
    const s = dem.get(v.sku) ?? new Set<string>();
    s.add(v.storeId);
    dem.set(v.sku, s);
  }
  const store = new Map<string, string>();
  for (const [sku, bo] of dem) if (bo.size === 1) store.set(sku, [...bo][0]!);
  if (store.size === 0) return ket;

  const gia = await db.select({
    sku: schema.skuCosts.sku,
    storeId: schema.skuCosts.storeId,
    costPerUnit: schema.skuCosts.costPerUnit,
    currency: schema.skuCosts.currency,
    effectiveFrom: schema.skuCosts.effectiveFrom,
  }).from(schema.skuCosts).where(and(
    inArray(schema.skuCosts.sku, [...store.keys()]),
    inArray(schema.skuCosts.storeId, [...new Set(store.values())]),
  ));

  const theoSku = new Map<string, typeof gia>();
  for (const g of gia) {
    // Dòng của store KHÁC store của sku thì bỏ — cùng một sku có thể xuất hiện
    // ở nhiều store trong bảng giá.
    if (store.get(g.sku) !== g.storeId) continue;
    const arr = theoSku.get(g.sku) ?? [];
    arr.push(g);
    theoSku.set(g.sku, arr);
  }

  for (const [sku, arr] of theoSku) {
    const tot = chonGiaVon(arr, ngay);
    if (!tot) continue;
    const v = Number(tot.costPerUnit);
    if (Number.isFinite(v)) ket.set(sku, { gia: v, tienTe: tot.currency });
  }
  return ket;
}
