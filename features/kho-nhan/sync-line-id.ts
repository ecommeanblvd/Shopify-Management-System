/**
 * Điền `lark_mon_don.shopify_line_id` cho các món chưa nối. Chạy sau mỗi lượt đồng bộ bảng
 * món (mỗi giờ) — best-effort, hỏng thì báo lỗi lên (xem features/lark/sync-brand-received.ts).
 *
 * Hai tiến trình cron độc lập (scripts/cron/sync-lark.ts + app/api/cron/sync-lark/route.ts) có
 * thể chạy chồng nhau. Vì vậy:
 *  - Khoá advisory (xact-scoped) quanh cả lượt nối: tiến trình thứ hai KHÔNG chờ, chỉ bỏ lượt
 *    (đọc snapshot cũ rồi gán vẫn có thể trùng dù có khoá lỏng lẻo hơn) — xem `boQua`.
 *  - Unique index MỘT PHẦN `lark_mon_don_line_uniq` (migration 0158) là lưới an toàn tầng DB,
 *    phòng khi khoá bị bỏ qua vì lý do nào đó (review 23/09/2026, Finding 1).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { chonDongChoMon, type DongDonToiThieu } from './noi-mon-dong-don';

const MOI_LUOT = 2000;

/** Khoá cố định cho việc nối line id — chỉ cần khác các khoá advisory khác đang dùng trong repo
 *  (xem features/shopify-orders/cron/hourly-sync.ts, khoá theo hash cửa hàng, không đụng số này). */
const KHOA_NOI_LINE_ID = 875_302_114;

export interface KetQuaNoiLine {
  xet: number;
  noiDuoc: number;
  /** true = tiến trình khác đang nối cùng lúc, lượt này bỏ qua (không đọc snapshot cũ để gán). */
  boQua?: boolean;
}

type MonChuaNoi = { dinhDanh: string; orderNumber: string; sku: string | null };

export async function noiLineIdChoMon(): Promise<KetQuaNoiLine> {
  return db.transaction(async (tx) => {
    const khoa = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${KHOA_NOI_LINE_ID}) as locked`,
    );
    if (!khoa.rows[0]?.locked) {
      // Tiến trình khác đang chạy — bỏ lượt này thay vì đọc snapshot cũ rồi gán trùng dòng.
      return { xet: 0, noiDuoc: 0, boQua: true };
    }
    return noiTrongKhoa(tx);
  });
}

/** Chạy khi ĐÃ giữ khoá advisory — tách riêng để dễ đọc, không export. */
async function noiTrongKhoa(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<KetQuaNoiLine> {
  const chua: MonChuaNoi[] = await tx
    .select({ dinhDanh: schema.larkMonDon.dinhDanh, orderNumber: schema.larkMonDon.orderNumber, sku: schema.larkMonDon.sku })
    .from(schema.larkMonDon)
    .where(isNull(schema.larkMonDon.shopifyLineId))
    .limit(MOI_LUOT);
  if (chua.length === 0) return { xet: 0, noiDuoc: 0 };

  const donSo = [...new Set(chua.map((m) => m.orderNumber))];

  // Dòng đơn Shopify của MỌI đơn liên quan trong batch — 1 truy vấn thay vì 1/đơn (N+1, xem
  // features/shipments/import-actions.ts:resolveOrderIds cho cùng kiểu "cả hai dạng có/không '#'").
  const bothForms = [...donSo, ...donSo.map((n) => `#${n}`)];
  const dongRows = await tx
    .select({
      shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
      sku: schema.shopifyOrderLines.sku,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .where(inArray(schema.shopifyOrders.shopifyOrderNumber, bothForms));

  const theoDonDong = new Map<string, { shopifyLineId: string; sku: string | null }[]>();
  for (const r of dongRows) {
    const don = r.orderNumber.replace(/^#/, '');
    const ds = theoDonDong.get(don) ?? [];
    ds.push({ shopifyLineId: r.shopifyLineId, sku: r.sku });
    theoDonDong.set(don, ds);
  }

  // Dòng đã gán cho món khác từ trước (lượt này hoặc lượt trước) — cũng 1 truy vấn cho cả batch.
  const daGanRows = await tx
    .select({ orderNumber: schema.larkMonDon.orderNumber, lineId: schema.larkMonDon.shopifyLineId })
    .from(schema.larkMonDon)
    .where(and(inArray(schema.larkMonDon.orderNumber, donSo), isNotNull(schema.larkMonDon.shopifyLineId)));

  const theoDonDaGan = new Map<string, Set<string>>();
  for (const r of daGanRows) {
    if (!r.lineId) continue;
    const s = theoDonDaGan.get(r.orderNumber) ?? new Set<string>();
    s.add(r.lineId);
    theoDonDaGan.set(r.orderNumber, s);
  }

  // Gom món chưa nối theo đơn: một đơn nhiều món, và phải biết dòng nào đã gán để không gán trùng.
  const theoDonMon = new Map<string, MonChuaNoi[]>();
  for (const m of chua) theoDonMon.set(m.orderNumber, [...(theoDonMon.get(m.orderNumber) ?? []), m]);

  let noiDuoc = 0;
  for (const [don, dsMon] of theoDonMon) {
    const dong = theoDonDong.get(don);
    if (!dong || dong.length === 0) continue;

    const dungSan = theoDonDaGan.get(don) ?? new Set<string>();
    const ds: DongDonToiThieu[] = dong.map((x) => ({ shopifyLineId: x.shopifyLineId, sku: x.sku, daDung: dungSan.has(x.shopifyLineId) }));

    for (const m of dsMon) {
      const lineId = chonDongChoMon(m.sku, ds);
      if (!lineId) continue;
      await tx.update(schema.larkMonDon).set({ shopifyLineId: lineId }).where(eq(schema.larkMonDon.dinhDanh, m.dinhDanh));
      const d = ds.find((x) => x.shopifyLineId === lineId);
      if (d) d.daDung = true;
      noiDuoc++;
    }
  }
  return { xet: chua.length, noiDuoc };
}
