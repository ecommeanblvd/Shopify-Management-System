'use server';

import { headers } from 'next/headers';
import { eq, inArray, and, or, isNull, ne, gte } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';
import { pickBackfillOrderIds } from '@/features/mmp/backfill-select';
import { BRAND_STATUSES } from '@/features/fulfillment/brand-statuses';
import { BRAND_OWNED_STORES } from '@/features/mmp/brand-stores';

/**
 * Điều kiện "đơn đặt TỪ ngày này trở đi", theo `created_at_shopify` — mốc KHÁCH đặt đơn, không
 * phải lúc mình nhận dữ liệu về.
 *
 * Thêm 04/10/2026 khi CEO yêu cầu đẩy lại cho MMP các đơn từ 2026: trước đó `forcePushAllBrandOrders`
 * không có mốc nào, đẩy là đẩy sạch 12.807 đơn từ 2020. Lọc ngày phải nằm TRONG hàm đẩy chứ
 * không nằm trong script gọi nó — script có truy vấn riêng là bản thứ hai của cùng một câu hỏi,
 * đúng loại lỗi đã bỏ sót 5 đơn UPS ngày 03/10.
 */
function tuNgayTroDi(tuNgay?: string) {
  return tuNgay ? gte(schema.shopifyOrders.createdAtShopify, new Date(`${tuNgay}T00:00:00Z`)) : undefined;
}

/** Đẩy lại các đơn ĐÃ có dòng brand sang MMP (tồn đọng). pushOrderToMmp tự bỏ qua
 *  đơn đã sent-không-đổi (dedup phía mình) → chạy lại không flood; MMP dedupe là backstop.
 *  `limit` → chỉ đẩy N đơn đầu (để test trước khi chạy full); để trống = tất cả.
 *  `total` = tổng đơn eligible (trước khi giới hạn) để biết còn bao nhiêu. */
export interface BackfillResult { pushed: number; skipped: number; failed: number; total: number }

/** Nút operator (có auth) → đẩy đơn brand chưa gửi sang MMP. */
export async function backfillMmpOrders(opts?: { limit?: number }): Promise<BackfillResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
  return pushUnsentBrandOrders(opts);
}

/** LÕI không-auth: đẩy đơn brand CHƯA gửi sang MMP. Dùng bởi nút operator + cron
 *  (đơn brand chưa từng push không được retry-cron đụng tới — retry chỉ lo dòng
 *  pending/failed đã có; auto-push lại chỉ bắn lúc thao tác phân bổ). */
export async function pushUnsentBrandOrders(opts?: { limit?: number; sinceDays?: number }): Promise<BackfillResult> {
  // Cửa sổ ngày cho ĐƯỜNG CRON: chạy tự động mà không giới hạn thì lần đầu sẽ
  // dội sang MMP toàn bộ tồn đọng từ 2020 (2.233 đơn, đo 04/09) — đơn cũ có
  // trước khi tích hợp, không ai muốn nhận lại. Nút operator vẫn để trống =
  // không giới hạn, vì đó là thao tác có chủ ý.
  const moc = opts?.sinceDays && opts.sinceDays > 0
    ? new Date(Date.now() - opts.sinceDays * 86_400_000)
    : null;
  // Đơn có ≥1 dòng brand VÀ CHƯA gửi thành công sang MMP (chưa có dòng push,
  // hoặc đang pending/failed). LOẠI đơn đã 'sent': trước đây query lấy hết rồi
  // pushOrderToMmp tự bỏ qua đơn sent → khi bấm với limit N, N đơn đầu toàn
  // 'sent' → bỏ qua hết → "đẩy 0" dù vẫn còn đơn chưa gửi; chạy full thì lặp
  // hàng nghìn đơn 'sent' → dễ timeout. Lọc 'sent' ở SQL → limit trúng đúng đơn
  // cần gửi + không lặp thừa.
  // (Re-push đơn ĐÃ sent nhưng đổi nội dung: dùng badge resend từng đơn / cron.)
  const rows = await db
    .selectDistinct({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillmentLines)
    .innerJoin(
      schema.orderFulfillment,
      eq(schema.orderFulfillmentLines.fulfillmentId, schema.orderFulfillment.id),
    )
    .leftJoin(
      schema.mmpOrderPushes,
      eq(schema.mmpOrderPushes.orderId, schema.orderFulfillment.orderId),
    )
    .where(
      and(
        inArray(schema.orderFulfillmentLines.status, [...BRAND_STATUSES]),
        or(isNull(schema.mmpOrderPushes.status), ne(schema.mmpOrderPushes.status, 'sent')),
        ...(moc ? [gte(schema.orderFulfillment.createdAt, moc)] : []),
      ),
    );

  // + MỌI đơn của store RIÊNG của brand (tinhatelier/mirermirer-official) — cả
  // đơn không có dòng phân bổ brand vẫn thuộc brand đó (payload builder tự gửi
  // toàn bộ line cho store owned).
  const ownedRows = await db
    .selectDistinct({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .leftJoin(schema.mmpOrderPushes, eq(schema.mmpOrderPushes.orderId, schema.orderFulfillment.orderId))
    .where(
      and(
        inArray(schema.stores.name, Object.keys(BRAND_OWNED_STORES)),
        or(isNull(schema.mmpOrderPushes.status), ne(schema.mmpOrderPushes.status, 'sent')),
        ...(moc ? [gte(schema.shopifyOrders.processedAtShopify, moc)] : []),
      ),
    );

  // Dedupe (nhiều dòng brand cùng đơn → 1 orderId); total = đơn CẦN gửi.
  const allIds = [...rows.map((r) => r.orderId), ...ownedRows.map((r) => r.orderId)];
  const total = new Set(allIds).size;
  const orderIds = pickBackfillOrderIds(allIds, opts?.limit);

  let pushed = 0,
    skipped = 0,
    failed = 0;
  for (const oid of orderIds) {
    const r = await pushOrderToMmp(oid);
    if (r.ok && !r.skipped) pushed++;
    else if (r.skipped || r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
  }
  return { pushed, skipped, failed, total };
}

/** Đẩy MỌI đơn của các store RIÊNG của brand (tinhatelier, mirermirer-official)
 *  sang MMP — scope ĐÚNG 2 store này, KHÔNG kéo theo đơn brand của store khác
 *  (khác pushUnsentBrandOrders) và KHÔNG sót đơn owned-store thiếu dòng brand-status
 *  (khác forcePushAllBrandOrders). Store owned: mọi line thuộc brand nên payload
 *  builder tự gửi toàn bộ.
 *
 *  - `force`=false (mặc định): chỉ gửi đơn CHƯA 'sent' (dedup — chạy lại rẻ).
 *  - `force`=true: gửi lại tất cả kể cả đã sent (refresh status; MMP dedupe backstop).
 *  - `dryRun`=true: CHỈ đếm số đơn sẽ gửi, KHÔNG POST (read-only, để xác nhận trước).
 */
/**
 * `refresh`: quét MỌI đơn store riêng kể cả đã 'sent', nhưng đẩy KHÔNG force nên
 * `pushOrderToMmp` tự bỏ qua đơn payload không đổi. Dùng để MMP luôn có chi phí ship
 * mới nhất: hoá đơn carrier thường về SAU lần đẩy đầu, mà chế độ thường chỉ quét đơn
 * chưa 'sent' nên số cũ nằm lại bên MMP mãi (đo 11/09/2026: 14/20 đơn TA mẫu có
 * payload đã đổi mà chưa được gửi).
 */
export async function pushOwnedStoreOrders(opts?: {
  limit?: number;
  force?: boolean;
  refresh?: boolean;
  dryRun?: boolean;
  /** 'YYYY-MM-DD' — chỉ đơn đặt từ ngày này. Để trống = mọi đời. */
  tuNgay?: string;
  onProgress?: (done: number, total: number, pushed: number, failed: number) => void;
}): Promise<BackfillResult> {
  const ngay = tuNgayTroDi(opts?.tuNgay);
  const cond = opts?.force || opts?.refresh
    ? and(inArray(schema.stores.name, Object.keys(BRAND_OWNED_STORES)), ngay)
    : and(
        inArray(schema.stores.name, Object.keys(BRAND_OWNED_STORES)),
        or(isNull(schema.mmpOrderPushes.status), ne(schema.mmpOrderPushes.status, 'sent')),
        ngay,
      );
  const rows = await db
    .selectDistinct({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .leftJoin(schema.mmpOrderPushes, eq(schema.mmpOrderPushes.orderId, schema.orderFulfillment.orderId))
    .where(cond);

  const orderIds = pickBackfillOrderIds(rows.map((r) => r.orderId), opts?.limit);
  const total = orderIds.length;
  if (opts?.dryRun) return { pushed: 0, skipped: 0, failed: 0, total };

  let pushed = 0, skipped = 0, failed = 0, done = 0;
  for (const oid of orderIds) {
    const r = await pushOrderToMmp(oid, { force: opts?.force });
    if (r.ok && !r.skipped) pushed++;
    else if (r.skipped || r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
    done++;
    if (opts?.onProgress && done % 50 === 0) opts.onProgress(done, total, pushed, failed);
  }
  return { pushed, skipped, failed, total };
}

/** FORCE đẩy lại TẤT CẢ đơn brand (kể cả đã 'sent') sang MMP — đồng bộ lại toàn bộ
 *  để MMP dựng đủ brand. KHÔNG auth (chạy qua script/cron có chủ đích). `onProgress`
 *  để script in tiến độ. */
export async function forcePushAllBrandOrders(opts?: {
  limit?: number;
  /** 'YYYY-MM-DD' — chỉ đơn đặt từ ngày này. Để trống = MỌI ĐỜI (12.807 đơn từ 2020). */
  tuNgay?: string;
  /** Chỉ ĐẾM, không gửi gì. Luôn chạy một lượt này trước khi đẩy thật. */
  dryRun?: boolean;
  onProgress?: (done: number, total: number, pushed: number, failed: number) => void;
}): Promise<BackfillResult> {
  const rows = await db
    .selectDistinct({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillmentLines.fulfillmentId, schema.orderFulfillment.id))
    // Nối sang đơn để lọc được theo ngày đặt. Khoá ngoại nên không mất dòng nào.
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(inArray(schema.orderFulfillmentLines.status, [...BRAND_STATUSES]), tuNgayTroDi(opts?.tuNgay)));

  const orderIds = pickBackfillOrderIds(rows.map((r) => r.orderId), opts?.limit);
  const total = orderIds.length;
  if (opts?.dryRun) return { pushed: 0, skipped: 0, failed: 0, total };

  let pushed = 0, skipped = 0, failed = 0, done = 0;
  for (const oid of orderIds) {
    const r = await pushOrderToMmp(oid, { force: true });
    if (r.ok && !r.skipped) pushed++;
    else if (r.skipped || r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
    done++;
    if (opts?.onProgress && done % 100 === 0) opts.onProgress(done, total, pushed, failed);
  }
  return { pushed, skipped, failed, total };
}
