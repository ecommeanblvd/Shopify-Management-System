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
 *  - Ứng viên dòng đơn được lọc trùng theo `shopifyLineId` trước khi chọn (`locTrungTheoLineId`)
 *    VÀ mỗi lần ghi một món chạy trong SAVEPOINT riêng (`tx.transaction` lồng — Drizzle 0.45 +
 *    node-postgres ánh xạ sang `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` thật, xem
 *    node_modules/drizzle-orm/node-postgres/session.js): một món CHỈ đụng unique index (mã lỗi
 *    Postgres `23505`) thì chỉ rollback riêng món đó, không kéo sập cả lượt lên tới 2000 món đã
 *    ghi đúng trước nó (review 23/09/2026 vòng 2, Finding "một dòng xấu chặn đứng cả việc nối
 *    vĩnh viễn"). Lỗi KHÁC 23505 bị NÉM LẠI, làm sập cả lượt và ghi job là lỗi — một lỗi không
 *    phải unique-violation (statement_timeout, mất kết nối, ràng buộc khác...) là TÍN HIỆU cần
 *    biết, không phải nhiễu hàng-dòng an toàn để nuốt. Và nếu unique-violation TỰ NÓ trở thành
 *    nội bộ toàn phần (bỏ qua rất nhiều món mà không nối được món nào), `laLoiHeThong` bắt cả
 *    trường hợp đó thành lỗi luôn — vì nếu không, một lượt hỏng toàn phần vẫn được ghi 'ok' xanh
 *    giả trong `job_runs` (review 23/09/2026 vòng 3).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { pgErrorCode } from '@/features/customer-account/request-status';
import { chonDongChoMon, laLoiHeThong, locTrungTheoLineId, type DongDonToiThieu } from './noi-mon-dong-don';

const MOI_LUOT = 2000;

/** Mã lỗi Postgres của unique_violation — ở đây là index `lark_mon_don_line_uniq` (migration 0158). */
const MA_LOI_TRUNG = '23505';

/** THUẦN: lỗi này có phải unique-violation theo TỪNG DÒNG (an toàn bỏ qua nhờ savepoint) không?
 *  Bắt buộc dùng `pgErrorCode`: Drizzle bọc mọi lỗi truy vấn trong `DrizzleQueryError`, lớp này chỉ
 *  đặt `.query`/`.params`/`.cause` mà KHÔNG chép `.code` — đọc thẳng `e.code` luôn ra `undefined`,
 *  khiến mọi unique-violation bị coi là lỗi hệ thống và kéo sập cả lượt (review vòng 4). */
export function laLoiTrungDongDon(e: unknown): boolean {
  return pgErrorCode(e) === MA_LOI_TRUNG;
}

/** Khoá cố định cho việc nối line id — chỉ cần khác các khoá advisory khác đang dùng trong repo
 *  (xem features/shopify-orders/cron/hourly-sync.ts, khoá theo hash cửa hàng, không đụng số này). */
const KHOA_NOI_LINE_ID = 875_302_114;

export interface KetQuaNoiLine {
  xet: number;
  noiDuoc: number;
  /** Số món bị BỎ QUA vì ghi lỗi (vd đụng unique index `lark_mon_don_line_uniq`) — không làm mất
   *  các món khác trong cùng lượt (xem SAVEPOINT trong `noiTrongKhoa`). Không im lặng nuốt lỗi:
   *  luôn có mặt trong kết quả để `job_runs` (qua `ketThucJob(..., { summary: r })`) hiện "nối N,
   *  bỏ qua M" thay vì im lặng. */
  boSot: number;
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
      return { xet: 0, noiDuoc: 0, boSot: 0, boQua: true };
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
  if (chua.length === 0) return { xet: 0, noiDuoc: 0, boSot: 0 };

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
  let boSot = 0;
  for (const [don, dsMon] of theoDonMon) {
    const dong = theoDonDong.get(don);
    if (!dong || dong.length === 0) continue;

    const dungSan = theoDonDaGan.get(don) ?? new Set<string>();
    // Lọc trùng theo shopifyLineId TRƯỚC khi gán daDung: nếu shopify_order_lines lỡ có hai dòng
    // cùng id (lỗi đồng bộ), chỉ giữ một ứng viên — không để hai món trong cùng lượt cùng "thấy"
    // một id "chưa ai dùng" rồi cùng chọn nó.
    const dongDaLoc = locTrungTheoLineId(dong);
    const ds: DongDonToiThieu[] = dongDaLoc.map((x) => ({ shopifyLineId: x.shopifyLineId, sku: x.sku, daDung: dungSan.has(x.shopifyLineId) }));

    for (const m of dsMon) {
      const lineId = chonDongChoMon(m.sku, ds);
      if (!lineId) continue;
      try {
        // SAVEPOINT riêng cho từng món: `tx.transaction` lồng bên trong `tx.transaction` ngoài
        // cùng (đã giữ khoá advisory) ánh xạ sang SAVEPOINT thật ở driver node-postgres — lỗi ở
        // đây chỉ ROLLBACK TO SAVEPOINT riêng món này, transaction ngoài cùng và mọi UPDATE đã
        // ghi trước đó trong vòng lặp không bị ảnh hưởng. try/catch KHÔNG lồng tx.transaction sẽ
        // đầu độc cả transaction ngoài cùng.
        await tx.transaction(async (tx2) => {
          await tx2.update(schema.larkMonDon).set({ shopifyLineId: lineId }).where(eq(schema.larkMonDon.dinhDanh, m.dinhDanh));
        });
      } catch (e) {
        // CHỈ nuốt unique-violation (23505, đụng lark_mon_don_line_uniq) — đây là lỗi THẬT SỰ
        // theo từng dòng, an toàn bỏ qua nhờ savepoint. Mọi mã lỗi khác (statement_timeout, mất
        // kết nối, ràng buộc khác...) là TÍN HIỆU của việc gì đó hỏng ở tầng rộng hơn một dòng —
        // ném lại để sập cả lượt, `job_runs` ghi lỗi thay vì âm thầm đếm vào `boSot` (review
        // 23/09/2026 vòng 3: bắt-mọi-lỗi khiến một lượt hỏng toàn phần vẫn báo 'ok' xanh giả).
        if (!laLoiTrungDongDon(e)) throw e;
        boSot++;
        console.error(`[kho-nhan] nối line id: bỏ qua món ${m.dinhDanh} (đơn ${don}, dòng ${lineId}) do đụng unique index lark_mon_don_line_uniq:`, e instanceof Error ? e.message : e);
        continue;
      }
      const d = ds.find((x) => x.shopifyLineId === lineId);
      if (d) d.daDung = true;
      noiDuoc++;
    }
  }
  // Unique-violation TỰ NÓ trở thành nội bộ toàn phần (statement_timeout quá thấp, khoá tranh
  // chấp lark_mon_don...) vẫn có thể chạy hết cả lượt "sạch sẽ" nhờ savepoint cô lập từng dòng —
  // ném lỗi ở đây để job_runs ghi 'error' thay vì 'ok' kèm boSot cao ngất mà không ai để ý.
  if (laLoiHeThong(noiDuoc, boSot)) {
    throw new Error(
      `nối line id: bỏ qua ${boSot}/${chua.length} món do đụng unique index lark_mon_don_line_uniq mà không nối được món nào — nghi lỗi hệ thống (statement_timeout, khoá tranh chấp lark_mon_don...), không phải vài dòng xấu rời rạc`,
    );
  }
  return { xet: chua.length, noiDuoc, boSot };
}
