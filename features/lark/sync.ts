/**
 * Orchestrate sync Lark → shipments. Một lõi cho cả nút thủ công + cron.
 * One-way. Ghi đè field shipment chỉ khi Lark có giá trị. Idempotent.
 */
import { eq, desc, and, or, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords, listAllQcRecords } from './client';
import { parseQcRow, mapQcCheck, latestQcCheck } from './parse-qc-row';
import { parsePackRow, larkText, type PackRow } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps } from './classify';
import { resolveOrderIds } from '@/features/shipments/import-actions';
import { parseLarkStatus, resolveDeliveredAt } from './parse-status-row';
import { larkCreatedTime } from './record-select';
import { coThayDoi } from './khong-doi';

/** 1 dòng lark_sync_runs đã chuẩn hoá cho UI (ngày = ISO string, JSON đã ép kiểu). */
export interface LarkRunRow {
  ranAt: string;
  created: number; updated: number;
  unmatchedCount: number; skippedCount: number;
  unmatched: Array<{ orderNumber: string; reason: string }>;
  error: string | null;
}

/** Đọc lần sync gần nhất cho banner (RSC gọi, trả plain serializable). */
export async function getLatestLarkRun(): Promise<LarkRunRow | null> {
  const [r] = await db.select().from(schema.larkSyncRuns).orderBy(desc(schema.larkSyncRuns.ranAt)).limit(1);
  if (!r) return null;
  return {
    ranAt: r.ranAt.toISOString(),
    created: r.created, updated: r.updated,
    unmatchedCount: r.unmatchedCount, skippedCount: r.skippedCount,
    unmatched: (r.unmatched as Array<{ orderNumber: string; reason: string }>) ?? [],
    error: r.error,
  };
}

export interface LarkSyncSummary {
  created: number; updated: number;
  /** Số lệnh ghi ĐÃ BỎ QUA vì dữ liệu không đổi (xem khong-doi.ts). */
  boQuaKhongDoi?: number;
  unmatched: Array<{ orderNumber: string; reason: string }>;
  skipped: number; warnings: string[];
  larkStatusUpserted: number;
  qcUpserted: number;
  deliveryFrozen: number;
}

/** Số dòng tối đa mỗi transaction khi áp update/create (tránh transaction dài
 *  bị pooler timeout). */
const APPLY_CHUNK = 200;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Patch shipment từ PackRow — chỉ field Lark có giá trị (ghi đè có điều kiện). */
function patchFrom(row: PackRow): Record<string, unknown> {
  const p: Record<string, unknown> = { updatedAt: new Date() };
  if (row.weightKg != null) p.actualWeightKg = String(row.weightKg);
  if (row.dims) {
    p.dimLengthCm = String(row.dims.l); p.dimWidthCm = String(row.dims.w);
    if (row.dims.h != null) p.dimHeightCm = String(row.dims.h);
  }
  if (row.trackingNumber) p.trackingNumber = row.trackingNumber;
  if (row.carrierKey) p.carrierKey = row.carrierKey;
  if (row.labelDate) p.labelCreatedAt = row.labelDate;
  return p;
}

export async function syncLarkPacks(): Promise<LarkSyncSummary> {
  try {
    const records = await listAllRecords();
    const rows = records.map((r) => parsePackRow(r.fields)).filter((r) => r.orderNumber || r.logUniqueCode);

    // Maps đối chiếu
    // Nạp CẢ các cột mà patchFrom sẽ ghi, để bỏ qua lệnh ghi không đổi gì.
    // Trước 05/09 chỉ nạp 3 cột định danh → mọi dòng đều bị UPDATE mỗi lượt
    // (3.770 lệnh/lượt) dù dữ liệu y nguyên.
    const existing = await db
      .select({
        id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode,
        trackingNumber: schema.shipments.trackingNumber,
        actualWeightKg: schema.shipments.actualWeightKg,
        dimLengthCm: schema.shipments.dimLengthCm, dimWidthCm: schema.shipments.dimWidthCm,
        dimHeightCm: schema.shipments.dimHeightCm,
        carrierKey: schema.shipments.carrierKey, labelCreatedAt: schema.shipments.labelCreatedAt,
      })
      .from(schema.shipments);
    const shipmentById = new Map(existing.map((s) => [s.id, s as Record<string, unknown>]));
    const shipmentByLogCode = new Map<string, string>();
    const shipmentByTracking = new Map<string, string>();
    for (const s of existing) {
      if (s.logUniqueCode) shipmentByLogCode.set(s.logUniqueCode, s.id);
      if (s.trackingNumber) shipmentByTracking.set(s.trackingNumber, s.id);
    }
    const orderIdByNumber = await resolveOrderIds(rows.map((r) => r.orderNumber).filter(Boolean));

    const maps: ClassifyMaps = { shipmentByLogCode, shipmentByTracking, orderIdByNumber };
    const cls = classifyPackRows(rows, maps);

    // Áp theo LÔ NHỎ, mỗi lô 1 transaction ngắn. KHÔNG gộp ~2800 update vào 1
    // transaction khổng lồ: transaction dài bị Supabase pooler timeout/rớt
    // connection giữa chừng ("Failed query"). Sync idempotent nên fail giữa lô
    // không sao — chạy lại tiếp tục.
    // BỎ QUA dòng không đổi gì: mỗi lệnh ghi là một vòng tới database, mà cron
    // có thể chạy khác vùng với DB (~270ms/lệnh) — bỏ được lệnh nào là bớt
    // ngần ấy thời gian.
    const canUpdate = cls.update
      .map((u) => ({ u, patch: patchFrom(u.row) }))
      .filter(({ u, patch }) => Object.keys(patch).length > 1 && coThayDoi(shipmentById.get(u.shipmentId), patch));
    const boQuaUpdate = cls.update.length - canUpdate.length;
    for (const batch of chunk(canUpdate, APPLY_CHUNK)) {
      await db.transaction(async (tx) => {
        for (const { u, patch } of batch) {
          await tx.update(schema.shipments).set(patch).where(eq(schema.shipments.id, u.shipmentId));
        }
      });
    }
    for (const batch of chunk(cls.create, APPLY_CHUNK)) {
      await db.transaction(async (tx) => {
        for (const c of batch) {
          await tx.insert(schema.shipments).values({
            orderId: c.orderId,
            logUniqueCode: c.row.logUniqueCode,
            trackingNumber: c.row.trackingNumber,
            carrierKey: c.row.carrierKey,
            actualWeightKg: c.row.weightKg != null ? String(c.row.weightKg) : null,
            dimLengthCm: c.row.dims ? String(c.row.dims.l) : null,
            dimWidthCm: c.row.dims ? String(c.row.dims.w) : null,
            dimHeightCm: c.row.dims?.h != null ? String(c.row.dims.h) : null,
            labelCreatedAt: c.row.labelDate,
          }).onConflictDoNothing();
        }
      });
    }

    // Phần B: snapshot status Lark theo orderId (ghi đè CÓ ĐIỀU KIỆN — record sau
    // bù field record trước thiếu; đơn nhiều kiện vẫn ra 1 dòng/đơn).
    const statusByOrderId = new Map<string, {
      dispatchStatus: string | null; cxFfStatus: string | null;
      deliveryStatus: string | null; expectedDeliveryDate: Date | null;
      deliveryState: import('@/lib/fedex/track').DeliveryStatus | null; actualDeliveredAt: Date | null;
    }>();
    // Gom record theo orderId, sort created_time TĂNG DẦN → fold (bản mới hơn ghi
    // đè field non-null). Xác định theo thời gian, không theo thứ tự Lark trả về.
    const recsByOrderId = new Map<string, typeof records>();
    for (const rec of records) {
      // larkText: unwrap cả dạng lookup {type,value:[{text}]} — Lark đổi kiểu cột
      // 'Order Number' ~08/07 làm typeof==='string' skip TOÀN BỘ (larkStatusUpserted=0,
      // deliveryFrozen=0 cả tuần mà cron vẫn "xanh"). Cùng lớp bug 25/06.
      const num = larkText(rec.fields['Order Number'])?.replace(/^#/, '') ?? null;
      if (!num) continue;
      const orderId = orderIdByNumber.get(num);
      if (!orderId) continue;
      const arr = recsByOrderId.get(orderId) ?? [];
      arr.push(rec);
      recsByOrderId.set(orderId, arr);
    }
    for (const [orderId, recs] of recsByOrderId) {
      const ordered = [...recs].sort((a, b) => larkCreatedTime(a) - larkCreatedTime(b));
      let acc = { dispatchStatus: null as string | null, cxFfStatus: null as string | null, deliveryStatus: null as string | null, expectedDeliveryDate: null as Date | null, deliveryState: null as import('@/lib/fedex/track').DeliveryStatus | null, actualDeliveredAt: null as Date | null };
      for (const rec of ordered) {
        const s = parseLarkStatus(rec.fields);
        acc = {
          dispatchStatus: s.dispatchStatus ?? acc.dispatchStatus,
          cxFfStatus: s.cxFfStatus ?? acc.cxFfStatus,
          deliveryStatus: s.deliveryStatus ?? acc.deliveryStatus,
          expectedDeliveryDate: s.expectedDeliveryDate ?? acc.expectedDeliveryDate,
          deliveryState: s.deliveryState === 'delivered' || acc.deliveryState === 'delivered' ? 'delivered' : (s.deliveryState ?? acc.deliveryState),
          actualDeliveredAt: s.actualDeliveredAt ?? acc.actualDeliveredAt,
        };
      }
      statusByOrderId.set(orderId, acc);
    }
    // Cùng lý do như phần shipments: bỏ qua dòng trạng thái không đổi
    // (~4.040 upsert mỗi lượt trước 05/09).
    const statusHienTai = new Map(
      (await db.select({
        orderId: schema.larkOrderStatus.orderId,
        dispatchStatus: schema.larkOrderStatus.dispatchStatus,
        cxFfStatus: schema.larkOrderStatus.cxFfStatus,
        deliveryStatus: schema.larkOrderStatus.deliveryStatus,
        expectedDeliveryDate: schema.larkOrderStatus.expectedDeliveryDate,
      }).from(schema.larkOrderStatus)).map((r) => [r.orderId, r as Record<string, unknown>]),
    );
    const statusRows = [...statusByOrderId.entries()].filter(([orderId, s]) => coThayDoi(statusHienTai.get(orderId), {
      dispatchStatus: s.dispatchStatus,
      cxFfStatus: s.cxFfStatus,
      deliveryStatus: s.deliveryStatus,
      expectedDeliveryDate: s.expectedDeliveryDate ? s.expectedDeliveryDate.toISOString().slice(0, 10) : null,
    }));
    const boQuaStatus = statusByOrderId.size - statusRows.length;
    let larkStatusUpserted = 0;
    for (const batch of chunk(statusRows, APPLY_CHUNK)) {
      await db.transaction(async (tx) => {
        for (const [orderId, s] of batch) {
          await tx.insert(schema.larkOrderStatus).values({
            orderId,
            dispatchStatus: s.dispatchStatus,
            cxFfStatus: s.cxFfStatus,
            deliveryStatus: s.deliveryStatus,
            expectedDeliveryDate: s.expectedDeliveryDate
              ? s.expectedDeliveryDate.toISOString().slice(0, 10) : null,
            syncedAt: new Date(),
          }).onConflictDoUpdate({
            target: schema.larkOrderStatus.orderId,
            set: {
              dispatchStatus: s.dispatchStatus,
              cxFfStatus: s.cxFfStatus,
              deliveryStatus: s.deliveryStatus,
              expectedDeliveryDate: s.expectedDeliveryDate
                ? s.expectedDeliveryDate.toISOString().slice(0, 10) : null,
              syncedAt: new Date(),
            },
          });
          larkStatusUpserted += 1;
        }
      });
    }

    // QC từ Lark QC table (best-effort): gom QC Check theo đơn → qc_status.
    let qcUpserted = 0;
    try {
      const qcRecords = await listAllQcRecords();
      if (qcRecords.length > 0) {
        const byNum = new Map<string, Array<{ qcCheck: string | null; createdTime: number }>>();
        for (const rec of qcRecords) {
          const { orderNumber, qcCheck } = parseQcRow(rec.fields);
          if (!orderNumber) continue;
          const bare = orderNumber.replace(/^#/, '');
          const arr = byNum.get(bare) ?? [];
          arr.push({ qcCheck, createdTime: larkCreatedTime(rec) });
          byNum.set(bare, arr);
        }
        const qcOrderIds = await resolveOrderIds([...byNum.keys()]);
        const qcRows: Array<{ orderId: string; qcStatus: string }> = [];
        for (const [bare, items] of byNum) {
          const orderId = qcOrderIds.get(bare);
          const status = mapQcCheck(latestQcCheck(items));
          if (orderId && status) qcRows.push({ orderId, qcStatus: status });
        }
        for (const batch of chunk(qcRows, APPLY_CHUNK)) {
          await db.transaction(async (tx) => {
            for (const q of batch) {
              await tx.insert(schema.larkOrderStatus).values({
                orderId: q.orderId, qcStatus: q.qcStatus, syncedAt: new Date(),
              }).onConflictDoUpdate({
                target: schema.larkOrderStatus.orderId,
                set: { qcStatus: q.qcStatus, syncedAt: new Date() },
              });
              qcUpserted += 1;
            }
          });
        }
      }
    } catch (e) {
      console.error('[lark] QC sync lỗi (bỏ qua, không chặn logistics):', e instanceof Error ? e.message : e);
    }

    // Freeze trạng thái giao từ Lark vào shipments (delivered sticky). Best-effort.
    let deliveryFrozen = 0;
    try {
      const delRows = [...statusByOrderId.entries()].filter(([, s]) => s.deliveryState != null);
      for (const batch of chunk(delRows, APPLY_CHUNK)) {
        await db.transaction(async (tx) => {
          for (const [orderId, s] of batch) {
            const patch: Record<string, unknown> = {
              deliveryStatus: s.deliveryState, deliverySource: 'lark', updatedAt: sql`now()`,
            };
            // Ngày giao: "Ngày giao thực tế" ops điền → "Ngày giao dự kiến" nếu đã
            // qua (row phát hiện muộn — cron chết dài ngày thì ngày sync sai cả
            // tháng) → thời điểm sync (sai số ≤1h khi cron chạy đều).
            if (s.deliveryState === 'delivered') patch.deliveredAt = resolveDeliveredAt(s);
            // GUARD (29/07): pack CHƯA ship (không tracking, không label) thì không
            // thể "delivered" — cột Final|Delivery Status trên Lark từng đánh nhầm
            // cho 16 đơn Invalid Address/đang hold, làm SMS ghi delivered ảo.
            const notYetShippedGuard = s.deliveryState === 'delivered'
              ? [or(isNotNull(schema.shipments.trackingNumber), isNotNull(schema.shipments.labelCreatedAt))!]
              : [];
            const res = await tx.update(schema.shipments).set(patch).where(and(
              eq(schema.shipments.orderId, orderId),
              or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
              ...notYetShippedGuard,
            ));
            deliveryFrozen += (res as { rowCount?: number }).rowCount ?? 0;
            // Row ĐÃ delivered nhưng thiếu ngày (đánh dấu trước khi có fallback, hoặc
            // ops điền ngày muộn) → lấp ngày, không đổi status.
            if (s.deliveryState === 'delivered') {
              await tx.update(schema.shipments)
                .set({ deliveredAt: resolveDeliveredAt(s), updatedAt: sql`now()` })
                .where(and(
                  eq(schema.shipments.orderId, orderId),
                  eq(schema.shipments.deliveryStatus, 'delivered'),
                  isNull(schema.shipments.deliveredAt),
                ));
            }
            // TỰ CHỮA LÀNH: ops điền "Ngày giao thực tế" MUỘN (sau khi row đã bị
            // đóng ngày fallback) → sửa lại theo ngày thực. CHỈ đè nguồn 'lark' —
            // POD bill carrier (D-019) và FedEx track không bị đụng.
            if (s.deliveryState === 'delivered' && s.actualDeliveredAt) {
              await tx.update(schema.shipments)
                .set({ deliveredAt: s.actualDeliveredAt, updatedAt: sql`now()` })
                .where(and(
                  eq(schema.shipments.orderId, orderId),
                  eq(schema.shipments.deliveryStatus, 'delivered'),
                  eq(schema.shipments.deliverySource, 'lark'),
                  ne(schema.shipments.deliveredAt, s.actualDeliveredAt),
                ));
            }
          }
        });
      }
    } catch (e) {
      console.error('[lark] freeze delivery lỗi (bỏ qua, không chặn logistics):', e instanceof Error ? e.message : e);
    }

    const warnings = rows.flatMap((r) => r.warnings.map((w) => `${r.orderNumber || r.logUniqueCode}: ${w}`));
    // `updated` nay là số dòng THẬT SỰ ghi, không phải số dòng xét — để nhật ký
    // phản ánh đúng khối lượng ghi. Thêm boQuaKhongDoi để thấy hiệu quả.
    const summary: LarkSyncSummary = { created: cls.create.length, updated: canUpdate.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings, larkStatusUpserted, qcUpserted, deliveryFrozen, boQuaKhongDoi: boQuaUpdate + boQuaStatus };

    // Ghi nhật ký ngoài transaction (chỉ để theo dõi). Nếu lỗi → log, KHÔNG
    // nuốt im: thay đổi đã áp xong, nhưng ta cần biết audit-row rớt.
    try {
      await db.insert(schema.larkSyncRuns).values({
        created: summary.created, updated: summary.updated,
        unmatchedCount: summary.unmatched.length, skippedCount: summary.skipped,
        unmatched: summary.unmatched,
      });
    } catch (logErr) {
      console.error('[lark] ghi lark_sync_runs thất bại sau khi sync xong:', logErr);
    }
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.insert(schema.larkSyncRuns).values({ error: msg }).catch(() => {});
    throw e;
  }
}
