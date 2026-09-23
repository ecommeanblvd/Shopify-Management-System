/** Truy vấn cho màn "Nhận hàng & KCS": món của đơn + việc đã làm hôm nay. */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { searchWhInventoryByDon } from '@/features/lark/client';
import { timDongTheoMon, docDongKho, type KetQuaKhoTrenLark } from '@/features/lark/wh-inventory';
import { maTemChoMon } from '@/features/kho-nhan/noi-mon-dong-don';

export interface MonCuaDon {
  dinhDanh: string;
  recordId: string | null;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  huy: boolean;
  lyDoHuy: string | null;
  /** Dòng đơn Shopify tương ứng (nối theo SKU khi đẩy Lark — xem noi-mon-dong-don.ts). null khi chưa nối được. */
  shopifyLineId: string | null;
  /** Mã biến thể Shopify của dòng đơn trên — lấy qua join, không tự suy ra khi thiếu dòng đơn. */
  shopifyVariantId: string | null;
  /** Mã in tem cho món này — dòng đơn trước, rồi biến thể; null khi cả hai đều thiếu (xem AGENTS/task-5 report). */
  maTem: string | null;
  /** Lúc dán tem mã vạch cho món này (ISO), null nếu chưa in. */
  temInLuc: string | null;
  /** Kết quả kho đã ghi cho món này trong SMS (nếu có) — nhập tiếp là SỬA, không tạo dòng hai. */
  daNhan: {
    luc: string; qcCheck: string; whAction: string; soLuong: number; canKg: number | null;
    trangThaiDay: string; lyDoFail: string | null; anhKey: string | null;
  } | null;
  /**
   * Dòng kho ĐANG có trên Lark của món này. 8.858/9.007 dòng Lark đã có kết quả nên phần lớn
   * món mở ra là đã có sẵn: không đọc thì màn hiện mặc định trắng và bấm Lưu là ghi đè kết
   * quả thật của kho.
   */
  larkCu: KetQuaKhoTrenLark | null;
}

export interface MonCuaDonKetQua {
  mon: MonCuaDon[];
  /** Đọc Lark hỏng thì màn VẪN chạy (larkCu = null) nhưng phải nói rõ cho kho biết. */
  loiLark: string | null;
}

export async function timMonCuaDon(orderNumber: string, opts?: { theoOrderId?: string }): Promise<MonCuaDonKetQua> {
  let bare = orderNumber.trim().replace(/^#/, '');
  // Quét mã tem ĐƠN (O:<shopifyOrderId>) không cho mã đơn dạng người đọc — tra ngược
  // sang shopify_orders để lấy shopifyOrderNumber rồi mở đơn như quét tay bình thường.
  if (opts?.theoOrderId) {
    const [don] = await db.select({ shopifyOrderNumber: schema.shopifyOrders.shopifyOrderNumber })
      .from(schema.shopifyOrders)
      .where(sql`regexp_replace(${schema.shopifyOrders.shopifyOrderId}, '^.*/', '') = ${opts.theoOrderId}`)
      .limit(1);
    if (!don) return { mon: [], loiLark: null };
    bare = don.shopifyOrderNumber.trim().replace(/^#/, '');
  }
  if (!bare) return { mon: [], loiLark: null };
  const m = schema.larkMonDon, w = schema.whNhanKcs;
  const rows = await db.select({
    dinhDanh: m.dinhDanh, recordId: m.recordId, sku: m.sku, lineitemName: m.lineitemName,
    store: m.store, vendor: m.vendor, huy: m.huy, lyDoHuy: m.lyDo,
    wLuc: w.luc, wQc: w.qcCheck, wAction: w.whAction, wSl: w.soLuong, wCan: w.canKg,
    wTrangThai: w.trangThaiDay, wLyDo: w.lyDoFail, wAnh: w.anhKey,
    shopifyLineId: m.shopifyLineId,
    shopifyVariantId: schema.shopifyOrderLines.shopifyVariantId,
    temInLuc: w.temInLuc,
  }).from(m)
    .leftJoin(w, eq(w.monDinhDanh, m.dinhDanh))
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, m.shopifyLineId))
    .where(eq(m.orderNumber, bare))
    .orderBy(m.sku);

  // shopify_order_lines KHÔNG có ràng buộc unique trên shopify_line_id (đơn được ghi lại bằng
  // xoá-rồi-chèn mỗi lần sync — features/shopify-orders/sync/upsert-order.ts — mà cron giờ chỉ
  // khoá advisory theo STORE, webhook thì không khoá gì) nên có lúc tạm thời tồn tại hai dòng
  // cùng line id, và join phía trên nhân đôi món Lark tương ứng. m.dinhDanh là khoá chính của
  // lark_mon_don nên chỉ giữ bản gặp đầu tiên mỗi dinhDanh là đủ để một món Lark ra đúng một
  // dòng (review 23/09/2026 Finding 2) — KHÔNG đụng tới bảng/khoá của shopify_order_lines, đó
  // là việc của task khác.
  const dinhDanhDaGap = new Set<string>();
  const rowsMotLan = rows.filter((r) => {
    if (dinhDanhDaGap.has(r.dinhDanh)) return false;
    dinhDanhDaGap.add(r.dinhDanh);
    return true;
  });

  // Một lượt gọi Lark cho cả đơn; lọc tiếp theo liên kết món ở phía SMS.
  let dsLark: Awaited<ReturnType<typeof searchWhInventoryByDon>> = [];
  let loiLark: string | null = null;
  if (rowsMotLan.some((r) => r.recordId)) {
    try {
      dsLark = await searchWhInventoryByDon(bare);
    } catch (e) {
      loiLark = e instanceof Error ? e.message : String(e);
    }
  }

  const mon = rowsMotLan.map((r) => {
    const dong = r.recordId ? timDongTheoMon(dsLark, r.recordId) : null;
    return {
      dinhDanh: r.dinhDanh, recordId: r.recordId, sku: r.sku, lineitemName: r.lineitemName,
      store: r.store, vendor: r.vendor, huy: r.huy, lyDoHuy: r.lyDoHuy,
      shopifyLineId: r.shopifyLineId,
      shopifyVariantId: r.shopifyVariantId,
      maTem: maTemChoMon({ shopifyLineId: r.shopifyLineId, shopifyVariantId: r.shopifyVariantId }),
      temInLuc: r.temInLuc ? r.temInLuc.toISOString() : null,
      daNhan: r.wLuc
        ? {
          luc: r.wLuc.toISOString(), qcCheck: r.wQc!, whAction: r.wAction!, soLuong: r.wSl!,
          canKg: r.wCan != null ? Number(r.wCan) : null, trangThaiDay: r.wTrangThai!,
          lyDoFail: r.wLyDo ?? null, anhKey: r.wAnh ?? null,
        }
        : null,
      larkCu: dong ? docDongKho(dong) : null,
    };
  });
  return { mon, loiLark };
}

export async function listDaXuLyHomNay() {
  const w = schema.whNhanKcs;
  const rows = await db.select().from(w)
    // Ngày VN = UTC+7 (xem lib/timezone.ts).
    .where(sql`(${w.luc} + interval '7 hours')::date = (now() + interval '7 hours')::date`)
    .orderBy(desc(w.luc))
    .limit(200);
  return rows.map((r) => ({
    id: r.id, orderNumber: r.orderNumber, sku: r.sku, qcCheck: r.qcCheck, whAction: r.whAction,
    nguoiLam: r.nguoiLam, luc: r.luc.toISOString(), trangThaiDay: r.trangThaiDay,
    larkRecordId: r.larkRecordId, loi: r.loi,
  }));
}
