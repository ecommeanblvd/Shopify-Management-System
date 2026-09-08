/**
 * Đồng bộ "Cost per item" (`InventoryItem.unitCost`) từ Shopify → `sku_costs`
 * cho các store TỰ SẢN XUẤT (xem `vendor-tu-san-xuat.ts`): tinhatelier,
 * mirermirer-official, meanblvd. Đây là NGUỒN GIÁ cho `own-cogs.ts` ghi
 * `order_line_cogs` theo line — khác hàng outsource (giá đến từ bảng kê brand,
 * `bang-ke-import.ts`).
 *
 * Chỉ ghi khi giá THẬT SỰ ĐỔI (`khacGia`) — tránh mỗi ngày insert một dòng
 * `sku_costs` y hệt hôm trước, làm phình bảng lịch sử giá vô nghĩa.
 */
import { db, schema } from '@/db/client';
import { getEnv } from '@/lib/env';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { BRAND_OWNED_STORES } from '@/features/mmp/brand-stores';
import { ngayKinhDoanh } from '@/lib/timezone';

export interface UnitCostRow { sku: string; amount: number; currency: string }

/**
 * THUẦN: giá SKU mới đọc từ Shopify có khác giá hiệu lực hiện tại (`cu`)
 * không — khác khi CHƯA có giá hiệu lực, hoặc lệch tiền tệ, hoặc lệch số quá
 * sai số làm tròn (0.0001).
 */
export function khacGia(cu: { costPerUnit: string; currency: string } | null, moi: UnitCostRow): boolean {
  if (!cu) return true;
  if (cu.currency !== moi.currency) return true;
  return Math.abs(Number(cu.costPerUnit) - moi.amount) > 0.0001;
}

const QUERY = `query($after: String) {
  productVariants(first: 250, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      inventoryItem { unitCost { amount currencyCode } }
    }
  }
}`;

interface VariantNode {
  sku: string | null;
  inventoryItem: { unitCost: { amount: string | null; currencyCode: string } | null } | null;
}
interface QueryData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: VariantNode[];
  };
}

/**
 * Đọc "Cost per item" mọi biến thể của một store, phân trang
 * `productVariants(first: 250)`. Chỉ giữ dòng CÓ sku và `unitCost.amount > 0`
 * — biến thể chưa khai giá vốn trên Shopify trả về null/0, bỏ qua (không có
 * gì để ghi). `apiVersion` ưu tiên cột `stores.api_version` (giống mọi call
 * site Shopify khác trong repo — mỗi store có thể ở version khác nhau),
 * fallback `SHOPIFY_API_VERSION` khi store chưa có giá trị này.
 */
export async function docUnitCostShopify(store: { id: string; shopDomain: string; apiVersion?: string | null }): Promise<UnitCostRow[]> {
  const token = await getStoreToken(store.id);
  const apiVersion = store.apiVersion ?? getEnv().SHOPIFY_API_VERSION;
  const out: UnitCostRow[] = [];
  let after: string | null = null;
  do {
    const res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion, token, query: QUERY, variables: { after } });
    // graphqlCall() không tự ném lỗi khi Shopify trả `errors` cùng `data`
    // rỗng/thiếu field (lỗi truy vấn, không phải lỗi HTTP) — kiểm tay trước
    // khi đụng `res.data`, tránh đọc `undefined.productVariants` mù mờ.
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      throw new Error(`Shopify GraphQL: ${JSON.stringify(res.errors).slice(0, 200)}`);
    }
    const data = res.data as QueryData;
    for (const n of data.productVariants.nodes) {
      const amount = Number(n.inventoryItem?.unitCost?.amount ?? 0);
      if (n.sku && amount > 0) {
        out.push({ sku: n.sku, amount, currency: n.inventoryItem!.unitCost!.currencyCode });
      }
    }
    after = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** Store TỰ SẢN XUẤT cần đồng bộ giá: mọi `BRAND_OWNED_STORES` + `meanblvd`
 *  (đa-brand, nhưng vendor MEAN BLVD tự sản xuất — xem `vendor-tu-san-xuat.ts`). */
function tenStoreTuSanXuat(): string[] {
  return [...Object.keys(BRAND_OWNED_STORES), 'meanblvd'];
}

interface GiaHienTai { costPerUnit: string; currency: string }

/**
 * Giá hiệu lực HIỆN TẠI (effective_from mới nhất ≤ `homNay`) của MỌI sku
 * store này đã từng khai — MỘT truy vấn duy nhất (`DISTINCT ON` theo sku,
 * sắp giảm dần effective_from), thay vì một SELECT riêng cho từng SKU trong
 * vòng lặp (store TINH ~1.300 dòng/12 tháng → hàng trăm round-trip DB nếu
 * làm theo SKU).
 */
async function giaHienTaiTheoStore(storeId: string, homNay: string): Promise<Map<string, GiaHienTai>> {
  const { rows } = await db.$client.query(
    `SELECT DISTINCT ON (sku) sku, cost_per_unit, currency
     FROM sku_costs
     WHERE store_id = $1 AND effective_from <= $2::date
     ORDER BY sku, effective_from DESC`,
    [storeId, homNay],
  );
  return new Map(
    (rows as Array<Record<string, unknown>>).map((r) => [
      String(r.sku),
      { costPerUnit: String(r.cost_per_unit), currency: String(r.currency) },
    ]),
  );
}

export interface SyncUnitCostOptions { dryRun?: boolean }
export interface SyncUnitCostResult { stores: number; doc: number; ghi: number; boQua: number; loi: string[] }

/**
 * Với mỗi store tự sản xuất: đọc "Cost per item" từ Shopify, so với giá hiệu
 * lực hiện tại (effective_from mới nhất ≤ hôm nay), giá NÀO KHÁC mới ghi dòng
 * `sku_costs` mới (effective_from = hôm nay, source = 'shopify'). Một store
 * lỗi (mất kết nối, chưa cấp token…) không chặn các store còn lại — lỗi được
 * gom vào `loi`.
 */
export async function syncUnitCost(opts: SyncUnitCostOptions = {}): Promise<SyncUnitCostResult> {
  const dryRun = opts.dryRun ?? false;
  const homNay = ngayKinhDoanh(new Date())!;

  const storeRows = await db.select().from(schema.stores);
  const byName = new Map(storeRows.map((s) => [s.name, s]));

  let stores = 0, doc = 0, ghi = 0, boQua = 0;
  const loi: string[] = [];

  for (const name of tenStoreTuSanXuat()) {
    const store = byName.get(name);
    if (!store) { loi.push(`store "${name}" chưa kết nối`); continue; }
    stores++;
    try {
      const unitCosts = await docUnitCostShopify({ id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion });
      doc += unitCosts.length;
      const hienTaiMap = await giaHienTaiTheoStore(store.id, homNay);

      for (const uc of unitCosts) {
        const hienTai = hienTaiMap.get(uc.sku) ?? null;
        if (!khacGia(hienTai, uc)) { boQua++; continue; }
        ghi++;
        if (dryRun) continue;

        await db.insert(schema.skuCosts).values({
          storeId: store.id,
          sku: uc.sku,
          costPerUnit: String(uc.amount),
          currency: uc.currency,
          effectiveFrom: homNay,
          source: 'shopify',
          uploadedBy: null,
        }).onConflictDoUpdate({
          target: [schema.skuCosts.storeId, schema.skuCosts.sku, schema.skuCosts.effectiveFrom],
          set: { costPerUnit: String(uc.amount), currency: uc.currency, source: 'shopify', uploadedAt: new Date() },
        });
      }
    } catch (err) {
      loi.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { stores, doc, ghi, boQua, loi };
}
