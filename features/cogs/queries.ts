/**
 * Truy vấn báo cáo giá vốn theo line đơn + lãi gộp theo tháng (spec 2026-09-08).
 *
 * Doanh thu đọc qua `getStoreMetrics` (nguồn sự thật cho revenue/ship-cost của
 * dashboard đơn hàng) — không tính lại công thức đó ở đây. Các bảng COGS
 * (`order_line_cogs`, `brand_cogs_offline`, `fx_month_rates`) đọc thẳng bằng SQL
 * gộp theo THÁNG NGHIỆP VỤ (giờ Bangkok, `sqlGioKinhDoanh`) — KHÔNG so mốc giờ
 * UTC, xem lib/timezone.ts.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import { getStoreMetrics } from '@/features/shopify-orders/dashboard-actions';
import type { DoanhThuThang, CogsThang, OfflineThang } from './bao-cao-logic';
import type { TiGiaThang } from './tien';

/** Mảnh SQL "tháng nghiệp vụ" (YYYY-MM) của một cột timestamp UTC — dùng để
 *  gộp/so kỳ trong SQL thay vì so mốc giờ UTC trực tiếp. */
function thangSql(cot: string): string {
  return `to_char(${sqlGioKinhDoanh(cot)}, 'YYYY-MM')`;
}

/** Biên tháng [đầu tháng, cuối tháng] theo GIỜ NGHIỆP VỤ (Asia/Bangkok), quy ra
 *  Date (UTC instant) để truyền cho `getStoreMetrics`. THUẦN. */
export function ranhThang(period: string): { from: Date; to: Date } {
  const [nam, thang] = period.split('-').map(Number);
  const namSau = thang === 12 ? nam + 1 : nam;
  const thangSau = thang === 12 ? 1 : thang + 1;
  const kySau = `${namSau}-${String(thangSau).padStart(2, '0')}`;
  const from = new Date(`${period}-01T00:00:00+07:00`);
  const to = new Date(new Date(`${kySau}-01T00:00:00+07:00`).getTime() - 1);
  return { from, to };
}

/**
 * Mọi cách viết THẬT của vendor Shopify khớp một brand (theo `mmp_brands`).
 *
 * Vendor trên `shopify_order_lines` do người bán/đối tác gõ tay trên Shopify —
 * lệch hoa/thường với `mmp_brands.display_name` là chuyện thường (thực tế bắt
 * được: 'Denio' VÀ 'DeNio' cùng tồn tại cho brand denio). `getStoreMetrics` lọc
 * vendor theo khớp CHÍNH XÁC (phân biệt hoa/thường) nên nếu chỉ truyền đúng
 * `display_name`, những đơn ghi vendor viết khác hoa/thường sẽ bị loại âm thầm
 * — doanh thu tính ra thiếu hoặc bằng 0 dù dữ liệu vẫn ở đó. Hàm này dò TRƯỚC
 * trong `shopify_order_lines` mọi spelling thật khớp `display_name`/`slug`
 * không phân biệt hoa/thường, rồi trả nguyên các spelling đó để truyền thẳng
 * vào `vendorFilter` (khớp chính xác từng spelling, không cần sửa
 * `getStoreMetrics`). Không tìm thấy spelling nào → trả `[displayName]`: bộ
 * lọc vẫn áp, ra rỗng — trung thực với thực trạng thay vì âm thầm bỏ lọc.
 */
async function vendorsCuaBrand(brandSlug: string): Promise<string[]> {
  const [row] = await db
    .select({ displayName: schema.mmpBrands.displayName, slug: schema.mmpBrands.slug })
    .from(schema.mmpBrands)
    .where(eq(schema.mmpBrands.slug, brandSlug));
  const displayName = row?.displayName ?? brandSlug;
  const slug = row?.slug ?? brandSlug;
  const { rows } = await db.$client.query(
    `SELECT DISTINCT vendor FROM shopify_order_lines
     WHERE vendor IS NOT NULL AND lower(vendor) IN (lower($1), lower($2))`,
    [displayName, slug],
  );
  const found = (rows as Array<{ vendor: string }>).map((r) => r.vendor);
  return found.length > 0 ? found : [displayName];
}

interface ThongKeLine { storeId: string; period: string; soLine: number; soLineCoCogs: number; doanhThuLineCoCogs: number; doanhThuLineTong: number }

/** Truy vấn phụ: đếm line + doanh thu line (unit_price×qty − discount_alloc) của
 *  các đơn CHƯA HUỶ trong `thang`/`storeIds`, tách có/không có `order_line_cogs`
 *  kind='cogs' (bất kỳ kỳ nhập) — gộp theo (storeId, period nghiệp vụ).
 *  `doanhThuLineTong` = cùng công thức nhưng KHÔNG lọc FILTER — tổng doanh thu
 *  TẤT CẢ line của bucket, làm mẫu số cho `phuDoanhThu` cùng cơ sở "line" với
 *  `doanhThuLineCoCogs` (khác `doanhThuThuan` ở mức đơn, có gồm cả shipping). */
async function thongKeLine(thang: string[], storeIds: string[], vendorNames?: string[]): Promise<ThongKeLine[]> {
  if (thang.length === 0 || storeIds.length === 0) return [];
  const { rows } = await db.$client.query(
    `SELECT o.store_id AS store_id, ${thangSql('o.processed_at_shopify')} AS period,
            count(*)::int AS so_line,
            count(clc.shopify_line_id)::int AS so_line_co_cogs,
            COALESCE(SUM(l.unit_price * l.quantity - l.discount_alloc) FILTER (WHERE clc.shopify_line_id IS NOT NULL), 0)::float8 AS doanh_thu_line_co_cogs,
            COALESCE(SUM(l.unit_price * l.quantity - l.discount_alloc), 0)::float8 AS doanh_thu_line_tong
     FROM shopify_order_lines l
     JOIN shopify_orders o ON o.id = l.order_id
     LEFT JOIN (SELECT DISTINCT order_id, shopify_line_id FROM order_line_cogs WHERE kind = 'cogs') clc
       ON clc.order_id = l.order_id AND clc.shopify_line_id = l.shopify_line_id
     WHERE o.store_id = ANY($1::uuid[])
       AND o.cancelled_at_shopify IS NULL
       AND ${thangSql('o.processed_at_shopify')} = ANY($2::text[])
       AND ($3::text[] IS NULL OR l.vendor = ANY($3::text[]))
     GROUP BY 1, 2`,
    [storeIds, thang, vendorNames ?? null],
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    storeId: String(r.store_id),
    period: String(r.period),
    soLine: Number(r.so_line),
    soLineCoCogs: Number(r.so_line_co_cogs),
    doanhThuLineCoCogs: Number(r.doanh_thu_line_co_cogs),
    doanhThuLineTong: Number(r.doanh_thu_line_tong),
  }));
}

/** Doanh thu theo tháng × store, đọc qua `getStoreMetrics` (spec §6). Bỏ đơn đã
 *  huỷ. `brand` lọc theo TẬP spelling vendor thật khớp brand đó (xem
 *  `vendorsCuaBrand` — vendor Shopify gõ tay, lệch hoa/thường với
 *  `mmp_brands.display_name`) — cả doanh thu lẫn line count đều lọc cùng tập
 *  spelling để `phuDoanhThu`/`phuLine` so được với nhau. */
export async function doanhThuTheoThang(thang: string[], storeIds: string[], brand?: string): Promise<DoanhThuThang[]> {
  if (thang.length === 0 || storeIds.length === 0) return [];
  const vendorNames = brand ? await vendorsCuaBrand(brand) : undefined;
  const thongKe = await thongKeLine(thang, storeIds, vendorNames);
  const layThongKe = (storeId: string, period: string) =>
    thongKe.find((t) => t.storeId === storeId && t.period === period);

  // Trang lãi-gộp mặc định 6 tháng × 4 store = 24 cặp (storeId, period) —
  // trước đây gọi getStoreMetrics tuần tự (~29s), giờ chạy song song bằng
  // Promise.all: build hết danh sách cặp, map sang promise rồi đợi tất cả.
  const capThangStore = thang.flatMap((period) => storeIds.map((storeId) => ({ period, storeId })));
  const ketQua = await Promise.all(
    capThangStore.map(async ({ period, storeId }) => {
      const { from, to } = ranhThang(period);
      const { orders } = await getStoreMetrics({ storeId, dateFrom: from, dateTo: to, vendorFilter: vendorNames });
      return { period, storeId, orders };
    }),
  );

  const out: DoanhThuThang[] = [];
  for (const { period, storeId, orders } of ketQua) {
    const active = orders.filter((o) => o.cancelledAt == null);
    if (active.length === 0) continue;
    const st = layThongKe(storeId, period);
    out.push({
      period,
      storeId,
      currency: active[0].currency,
      // = Net sales (khách thực trả), cùng định nghĩa với bảng Orders / KPI (D-061).
      doanhThuThuan: active.reduce((s, o) => s + o.netSales, 0),
      phiShip: active.reduce((s, o) => s + o.shippingCost, 0),
      soDon: active.length,
      soLine: st?.soLine ?? 0,
      soLineCoCogs: st?.soLineCoCogs ?? 0,
      doanhThuLineCoCogs: st?.doanhThuLineCoCogs ?? 0,
      doanhThuLineTong: st?.doanhThuLineTong ?? 0,
    });
  }
  return out;
}

/** COGS theo LINE đơn (`order_line_cogs`), gộp theo (period, storeId, brandSlug,
 *  currency) — sum(amount) đã gồm cả return (amount âm). `thuocThangTruoc` =
 *  phần amount của các đơn ĐẶT THÁNG TRƯỚC kỳ báo cáo (bảng kê brand chốt trễ).
 *  Lọc theo `brand` ở đây dùng thẳng `brand_slug` (cột có sẵn trên bảng, do
 *  chính import gán) — KHÔNG qua vendor nên không dính lệch hoa/thường. */
export async function cogsTheoThang(thang: string[], storeIds?: string[], brand?: string): Promise<CogsThang[]> {
  if (thang.length === 0) return [];
  const dieuKien: string[] = ['c.period = ANY($1::text[])'];
  const params: unknown[] = [thang];
  if (storeIds && storeIds.length > 0) { params.push(storeIds); dieuKien.push(`c.store_id = ANY($${params.length}::uuid[])`); }
  if (brand) { params.push(brand); dieuKien.push(`c.brand_slug = $${params.length}`); }

  const { rows } = await db.$client.query(
    `SELECT c.period, c.store_id, c.brand_slug, c.currency,
            SUM(c.amount)::float8 AS amount,
            COALESCE(SUM(c.amount) FILTER (WHERE ${thangSql('o.processed_at_shopify')} < c.period), 0)::float8 AS thuoc_thang_truoc
     FROM order_line_cogs c
     JOIN shopify_orders o ON o.id = c.order_id
     WHERE ${dieuKien.join(' AND ')}
     GROUP BY c.period, c.store_id, c.brand_slug, c.currency`,
    params,
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    period: String(r.period),
    storeId: r.store_id == null ? null : String(r.store_id),
    brandSlug: r.brand_slug == null ? null : String(r.brand_slug),
    amount: Number(r.amount),
    currency: String(r.currency),
    thuocThangTruoc: Number(r.thuoc_thang_truoc),
  }));
}

/** COGS offline brand (`brand_cogs_offline`: PO/MTB ngoài Shopify), gộp theo
 *  (period, brandSlug) — sum(amount) đã gồm cả return (amount âm). Lọc `brand`
 *  dùng thẳng `brand_slug` (cột sẵn có), không qua vendor. */
export async function offlineTheoThang(thang: string[], brand?: string): Promise<OfflineThang[]> {
  if (thang.length === 0) return [];
  const dieuKien: string[] = ['period = ANY($1::text[])'];
  const params: unknown[] = [thang];
  if (brand) { params.push(brand); dieuKien.push(`brand_slug = $${params.length}`); }

  const { rows } = await db.$client.query(
    `SELECT period, brand_slug, SUM(amount)::float8 AS amount
     FROM brand_cogs_offline
     WHERE ${dieuKien.join(' AND ')}
     GROUP BY period, brand_slug`,
    params,
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    period: String(r.period),
    brandSlug: String(r.brand_slug),
    amount: Number(r.amount),
  }));
}

/** Toàn bộ tỉ giá tháng đã nhập (`fx_month_rates`). */
export async function tiGiaThang(): Promise<TiGiaThang[]> {
  const rows = await db.select().from(schema.fxMonthRates);
  return rows.map((r) => ({ from: r.fromCurrency, to: r.toCurrency, period: r.period, rate: Number(r.rate) }));
}

/** Line của đơn CHƯA HUỶ đặt trong `period` (giờ nghiệp vụ) mà chưa có dòng
 *  `order_line_cogs` kind='cogs' (bất kỳ nguồn) — danh sách cho người nhập bù.
 *  `brand` lọc theo TẬP spelling vendor thật khớp brand đó (xem
 *  `vendorsCuaBrand` — cùng cách brand lọc trong `doanhThuTheoThang`, tránh
 *  lệch hoa/thường của vendor Shopify gõ tay). */
export async function lineChuaCoCogs(period: string, storeIds?: string[], brand?: string): Promise<Array<{ store: string; brand: string | null; maDon: string; sku: string | null; sl: number; doanhThu: number; currency: string }>> {
  const dieuKien: string[] = [`${thangSql('o.processed_at_shopify')} = $1`, 'o.cancelled_at_shopify IS NULL', 'c.id IS NULL'];
  const params: unknown[] = [period];
  if (storeIds && storeIds.length > 0) { params.push(storeIds); dieuKien.push(`o.store_id = ANY($${params.length}::uuid[])`); }
  if (brand) {
    const vendorNames = await vendorsCuaBrand(brand);
    params.push(vendorNames);
    dieuKien.push(`l.vendor = ANY($${params.length}::text[])`);
  }

  const { rows } = await db.$client.query(
    `SELECT s.name AS store, l.vendor AS brand, o.shopify_order_number AS ma_don, l.sku,
            l.quantity::int AS sl,
            (l.unit_price * l.quantity - l.discount_alloc)::float8 AS doanh_thu,
            o.currency
     FROM shopify_order_lines l
     JOIN shopify_orders o ON o.id = l.order_id
     JOIN stores s ON s.id = o.store_id
     LEFT JOIN order_line_cogs c ON c.order_id = l.order_id AND c.shopify_line_id = l.shopify_line_id AND c.kind = 'cogs'
     WHERE ${dieuKien.join(' AND ')}
     ORDER BY o.shopify_order_number, l.sku NULLS LAST`,
    params,
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    store: String(r.store),
    brand: r.brand == null ? null : String(r.brand),
    maDon: String(r.ma_don),
    sku: r.sku == null ? null : String(r.sku),
    sl: Number(r.sl),
    doanhThu: Number(r.doanh_thu),
    currency: String(r.currency),
  }));
}

/** Chi tiết mọi dòng COGS của một kỳ (line-level + offline), để soát/đối chiếu.
 *  Lọc `brand` dùng thẳng `brand_slug` (cột sẵn có trên cả hai bảng nguồn),
 *  không qua vendor nên không đụng vấn đề hoa/thường. */
export async function chiTietThang(period: string, brand?: string): Promise<Array<{ brandSlug: string | null; maDon: string; sku: string | null; amount: number; source: string; statementRef: string | null; kind: string }>> {
  const dieuKienLine: string[] = ['c.period = $1'];
  const dieuKienOffline: string[] = ['period = $1'];
  const params: unknown[] = [period];
  if (brand) { params.push(brand); dieuKienLine.push(`c.brand_slug = $${params.length}`); dieuKienOffline.push(`brand_slug = $${params.length}`); }

  const [lineRows, offlineRows] = await Promise.all([
    db.$client.query(
      `SELECT c.brand_slug, o.shopify_order_number AS ma_don, l.sku, c.amount::float8 AS amount, c.source, c.statement_ref, c.kind
       FROM order_line_cogs c
       JOIN shopify_orders o ON o.id = c.order_id
       LEFT JOIN shopify_order_lines l ON l.order_id = c.order_id AND l.shopify_line_id = c.shopify_line_id
       WHERE ${dieuKienLine.join(' AND ')}`,
      params,
    ),
    db.$client.query(
      `SELECT brand_slug, ref_code AS ma_don, sku, amount::float8 AS amount, 'offline' AS source, statement_ref, kind
       FROM brand_cogs_offline
       WHERE ${dieuKienOffline.join(' AND ')}`,
      params,
    ),
  ]);

  const map = (r: Record<string, unknown>) => ({
    brandSlug: r.brand_slug == null ? null : String(r.brand_slug),
    maDon: String(r.ma_don),
    sku: r.sku == null ? null : String(r.sku),
    amount: Number(r.amount),
    source: String(r.source),
    statementRef: r.statement_ref == null ? null : String(r.statement_ref),
    kind: String(r.kind),
  });
  return [...(lineRows.rows as Array<Record<string, unknown>>).map(map), ...(offlineRows.rows as Array<Record<string, unknown>>).map(map)];
}
