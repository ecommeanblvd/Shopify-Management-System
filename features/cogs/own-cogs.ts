/**
 * Ghi giá vốn theo LINE đơn (`order_line_cogs` kind='cogs') cho hàng TỰ SẢN
 * XUẤT (tinhatelier, mirermirer-official, meanblvd/MEAN BLVD — xem
 * `vendor-tu-san-xuat.ts`), lấy giá từ `sku_costs` (nạp bởi `unit-cost-sync.ts`
 * qua Shopify "Cost per item"). Hàng OUTSOURCE (brand khác gửi bảng kê PO/MTB)
 * KHÔNG đi qua đây — giá đến từ `bang-ke-import.ts`.
 *
 * `onConflictDoNothing`: nếu dòng COGS của line đã tồn tại (kể cả từ nguồn
 * khác — bảng kê nhập tay chẳng hạn) thì KHÔNG ghi đè, đúng nguyên tắc "nguồn
 * tay luôn thắng nguồn tự động" dùng xuyên suốt tính năng giá vốn.
 */
import { and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { BRAND_OWNED_STORES } from '@/features/mmp/brand-stores';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import { laHangTuSanXuat } from './vendor-tu-san-xuat';

const STORE_TU_SAN_XUAT = [...Object.keys(BRAND_OWNED_STORES), 'meanblvd'];

interface DongUngVien {
  orderId: string;
  shopifyLineId: string;
  storeId: string;
  storeName: string;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  /** 'YYYY-MM' — tháng nghiệp vụ (giờ Bangkok) của processed_at_shopify. */
  period: string;
  /** 'YYYY-MM-DD' — ngày nghiệp vụ (giờ Bangkok) của processed_at_shopify. */
  ngayDat: string;
}

export interface ApplyOwnCogsOptions { dryRun?: boolean }
export interface ApplyOwnCogsResult { xemXet: number; ghi: number; khongCoGia: number }

/**
 * Line của đơn 90 ngày gần đây (chưa huỷ) thuộc store tự sản xuất, CHƯA có
 * `order_line_cogs` kind='cogs' (bất kỳ nguồn) — ứng viên để tính giá vốn.
 * Lọc thô theo TÊN STORE ở SQL (giảm số dòng kéo về); lọc CHÍNH XÁC theo
 * vendor bằng `laHangTuSanXuat` (nguồn sự thật duy nhất) ở JS ngay sau đó.
 *
 * `period`/`ngay_dat` tính THẲNG TRONG SQL qua `sqlGioKinhDoanh` (giờ Bangkok)
 * — KHÔNG kéo `processed_at_shopify` (timestamp UTC-naive) ra JS rồi gọi
 * `ngayKinhDoanh`/`thangKinhDoanh` ở tầng ứng dụng: `pg` parse cột
 * `timestamp` (không múi giờ) theo múi giờ LOCAL của tiến trình Node (xem
 * cảnh báo ở `lib/timezone.ts`/`lib/timezone-bind.ts`) — chạy ở máy không
 * `TZ=UTC` (ví dụ Asia/Saigon +7) ra kỳ/ngày SAI, dù Railway luôn set
 * `TZ=UTC`. Tính trong SQL thì đúng bất kể tiến trình chạy ở đâu.
 */
async function ungVienChuaCoCogs(): Promise<DongUngVien[]> {
  const gioBangKok = sqlGioKinhDoanh('o.processed_at_shopify');
  const { rows } = await db.$client.query(
    `SELECT l.order_id, l.shopify_line_id, o.store_id, s.name AS store_name,
            l.sku, l.vendor, l.quantity::int AS quantity,
            to_char(${gioBangKok}, 'YYYY-MM') AS period,
            to_char(${gioBangKok}, 'YYYY-MM-DD') AS ngay_dat
     FROM shopify_order_lines l
     JOIN shopify_orders o ON o.id = l.order_id
     JOIN stores s ON s.id = o.store_id
     WHERE s.name = ANY($1::text[])
       AND o.cancelled_at_shopify IS NULL
       AND o.processed_at_shopify >= now() - interval '90 days'
       AND NOT EXISTS (
         SELECT 1 FROM order_line_cogs c
         WHERE c.order_id = l.order_id AND c.shopify_line_id = l.shopify_line_id AND c.kind = 'cogs'
       )`,
    [STORE_TU_SAN_XUAT],
  );

  return (rows as Array<Record<string, unknown>>)
    .map((r) => ({
      orderId: String(r.order_id),
      shopifyLineId: String(r.shopify_line_id),
      storeId: String(r.store_id),
      storeName: String(r.store_name),
      sku: r.sku == null ? null : String(r.sku),
      vendor: r.vendor == null ? null : String(r.vendor),
      quantity: Number(r.quantity),
      period: String(r.period),
      ngayDat: String(r.ngay_dat),
    }))
    .filter((r) => laHangTuSanXuat(r.storeName, r.vendor));
}

/**
 * Với mỗi line ứng viên: tra `sku_costs` cùng store, effective_from ≤ ngày
 * đặt (giờ nghiệp vụ), MỚI NHẤT — có giá thì ghi `order_line_cogs`
 * (amount = giá × số lượng), không có giá thì đếm vào `khongCoGia` (không
 * chặn các line khác).
 */
export async function applyOwnCogs(opts: ApplyOwnCogsOptions = {}): Promise<ApplyOwnCogsResult> {
  const dryRun = opts.dryRun ?? false;

  const ungVien = await ungVienChuaCoCogs();
  const xemXet = ungVien.length;
  if (xemXet === 0) return { xemXet: 0, ghi: 0, khongCoGia: 0 };

  const storeIds = [...new Set(ungVien.map((r) => r.storeId))];
  const skus = [...new Set(ungVien.map((r) => r.sku).filter((s): s is string => s !== null))];

  const gia = skus.length === 0 ? [] : await db
    .select({
      storeId: schema.skuCosts.storeId,
      sku: schema.skuCosts.sku,
      costPerUnit: schema.skuCosts.costPerUnit,
      currency: schema.skuCosts.currency,
      effectiveFrom: schema.skuCosts.effectiveFrom,
    })
    .from(schema.skuCosts)
    .where(and(inArray(schema.skuCosts.storeId, storeIds), inArray(schema.skuCosts.sku, skus)));

  // Gộp theo (storeId, sku), sắp giảm dần effective_from để tra "mới nhất ≤
  // ngày đặt" bằng .find() — cùng cách features/shopify-orders/dashboard-actions.ts
  // tra costIndex.
  const giaIndex = new Map<string, typeof gia>();
  for (const g of gia) {
    const key = `${g.storeId}|${g.sku}`;
    const arr = giaIndex.get(key);
    if (arr) arr.push(g); else giaIndex.set(key, [g]);
  }
  for (const arr of giaIndex.values()) arr.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  let ghi = 0, khongCoGia = 0;
  for (const line of ungVien) {
    const arr = line.sku ? giaIndex.get(`${line.storeId}|${line.sku}`) : undefined;
    const cost = arr?.find((g) => g.effectiveFrom <= line.ngayDat);
    if (!cost) { khongCoGia++; continue; }

    ghi++;
    if (dryRun) continue;

    const brandSlug = BRAND_OWNED_STORES[line.storeName]?.brandSlug ?? 'meanblvd';
    await db.insert(schema.orderLineCogs).values({
      orderId: line.orderId,
      shopifyLineId: line.shopifyLineId,
      storeId: line.storeId,
      kind: 'cogs',
      period: line.period,
      amount: String(Number(cost.costPerUnit) * line.quantity),
      currency: cost.currency,
      source: 'shopify_unit_cost',
      brandSlug,
      statementRef: 'shopify_unit_cost',
    }).onConflictDoNothing({
      target: [schema.orderLineCogs.orderId, schema.orderLineCogs.shopifyLineId, schema.orderLineCogs.kind, schema.orderLineCogs.period],
    });
  }

  return { xemXet, ghi, khongCoGia };
}
