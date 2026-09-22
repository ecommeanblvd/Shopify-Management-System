/**
 * Orchestrate sync Lark → shipments. Một lõi cho cả nút thủ công + cron.
 * One-way. Ghi đè field shipment chỉ khi Lark có giá trị. Idempotent.
 */
import { eq, desc, and, or, isNull, isNotNull, ne, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords, listAllQcRecords, type LarkRecord } from './client';
import { parseQcRow, mapQcCheck, latestQcCheck } from './parse-qc-row';
import { parsePackRow, larkText } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps } from './classify';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import { resolveOrderIds } from '@/features/shipments/import-actions';
import { parseLarkStatus, resolveDeliveredAt } from './parse-status-row';
import { larkCreatedTime } from './record-select';
import { coThayDoi } from '@/lib/khong-doi';
import { canDongTrangThai, canLapNgay, canSuaNgay, chonTrangThaiChoKien, type ShipmentHienTai, type TrangThaiGiaoLark } from './can-freeze';
import { NGUON_HANG } from './nguon-hang';

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
  /** Record Lark đã tải — chỉ có khi gọi với `giuRecords` (ghi ngược dùng lại, khỏi đọc thêm). */
  records?: LarkRecord[];
}

/** Số dòng tối đa mỗi transaction khi áp update/create (tránh transaction dài
 *  bị pooler timeout). */
const APPLY_CHUNK = 200;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function syncLarkPacks(opts?: { giuRecords?: boolean }): Promise<LarkSyncSummary> {
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
        orderId: schema.shipments.orderId,
        deliveryStatus: schema.shipments.deliveryStatus, deliveredAt: schema.shipments.deliveredAt,
        deliverySource: schema.shipments.deliverySource,
        skuText: schema.shipments.skuText, pieces: schema.shipments.pieces, larkHop: schema.shipments.larkHop,
      })
      .from(schema.shipments);
    const shipmentById = new Map(existing.map((s) => [s.id, s as Record<string, unknown>]));
    // Gom theo đơn để khối freeze biết TRƯỚC lệnh nào thật sự cần chạy.
    const shipmentsByOrder = new Map<string, ShipmentHienTai[]>();
    for (const sh of existing) {
      if (!sh.orderId) continue;
      const l = shipmentsByOrder.get(sh.orderId) ?? [];
      l.push({ id: sh.id, deliveryStatus: sh.deliveryStatus, deliveredAt: sh.deliveredAt,
        deliverySource: sh.deliverySource, trackingNumber: sh.trackingNumber, labelCreatedAt: sh.labelCreatedAt });
      shipmentsByOrder.set(sh.orderId, l);
    }
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
          await tx.insert(schema.shipments).values(giaTriTaoKien(c.row, c.orderId)).onConflictDoNothing();
        }
      });
    }

    // Kiện từng nằm ở "chờ khớp" (webhook /api/lark/pack) nay cron tạo được → gỡ khỏi màn Đóng hàng.
    const maVuaTao = cls.create.map((c) => c.row.logUniqueCode).filter((x): x is string => !!x);
    if (maVuaTao.length > 0) {
      await db.delete(schema.larkPackChoKhop).where(inArray(schema.larkPackChoKhop.logUniqueCode, maVuaTao));
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
    // Trạng thái giao THEO MÃ VẬN ĐƠN — Lark ghi mỗi kiện một dòng, đơn tách kiện có nhiều dòng
    // với ngày giao khác nhau. Khối freeze dùng bản này trước, xem `chonTrangThaiChoKien`.
    const giaoTheoTracking = new Map<string, TrangThaiGiaoLark>();
    for (const rec of [...records].sort((a, b) => larkCreatedTime(a) - larkCreatedTime(b))) {
      const tk = parsePackRow(rec.fields).trackingNumber?.trim();
      if (!tk) continue;
      const st = parseLarkStatus(rec.fields);
      const cu = giaoTheoTracking.get(tk);
      giaoTheoTracking.set(tk, {
        deliveryState: st.deliveryState === 'delivered' || cu?.deliveryState === 'delivered' ? 'delivered' : (st.deliveryState ?? cu?.deliveryState ?? null),
        actualDeliveredAt: st.actualDeliveredAt ?? cu?.actualDeliveredAt ?? null,
        expectedDeliveryDate: st.expectedDeliveryDate ?? cu?.expectedDeliveryDate ?? null,
      });
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
        // qc_status hiện có, để bỏ qua dòng không đổi — cùng lý do như hai phần
        // trên. Đây là phần ghi lớn nhất còn lại sau tối ưu 05/09 (3.600 lệnh).
        const qcHienTai = new Map(
          (await db.select({ orderId: schema.larkOrderStatus.orderId, qcStatus: schema.larkOrderStatus.qcStatus })
            .from(schema.larkOrderStatus)).map((r) => [r.orderId, r as Record<string, unknown>]),
        );
        const qcRows: Array<{ orderId: string; qcStatus: string }> = [];
        for (const [bare, items] of byNum) {
          const orderId = qcOrderIds.get(bare);
          const status = mapQcCheck(latestQcCheck(items));
          if (orderId && status && coThayDoi(qcHienTai.get(orderId), { qcStatus: status })) {
            qcRows.push({ orderId, qcStatus: status });
          }
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
      // Ghi THEO TỪNG KIỆN (CEO 16/09/2026): trước đây ghi theo orderId nên đơn tách kiện bị
      // gán cùng một ngày giao cho mọi kiện.
      const viec: Array<{ kien: ShipmentHienTai; s: TrangThaiGiaoLark }> = [];
      for (const [orderId, cuaDon] of statusByOrderId) {
        const dsShip = shipmentsByOrder.get(orderId) ?? [];
        for (const kien of dsShip) {
          const s = chonTrangThaiChoKien(kien, dsShip.length, giaoTheoTracking, cuaDon);
          if (s?.deliveryState != null && kien.id) viec.push({ kien, s });
        }
      }
      for (const batch of chunk(viec, APPLY_CHUNK)) {
        await db.transaction(async (tx) => {
          for (const { kien, s } of batch) {
            const mot = [kien];
            const laDelivered = s.deliveryState === 'delivered';
            const patch: Record<string, unknown> = {
              deliveryStatus: s.deliveryState, deliverySource: 'lark', updatedAt: sql`now()`,
            };
            // Ngày giao: "Ngày giao thực tế" ops điền → "Ngày giao dự kiến" nếu đã
            // qua (row phát hiện muộn — cron chết dài ngày thì ngày sync sai cả
            // tháng) → thời điểm sync (sai số ≤1h khi cron chạy đều).
            if (laDelivered) patch.deliveredAt = resolveDeliveredAt(s);
            // GUARD (29/07): pack CHƯA ship (không tracking, không label) thì không
            // thể "delivered" — cột Final|Delivery Status trên Lark từng đánh nhầm
            // cho 16 đơn Invalid Address/đang hold, làm SMS ghi delivered ảo.
            const notYetShippedGuard = laDelivered
              ? [or(isNotNull(schema.shipments.trackingNumber), isNotNull(schema.shipments.labelCreatedAt))!]
              : [];
            if (canDongTrangThai(mot, laDelivered)) {
              const res = await tx.update(schema.shipments).set(patch).where(and(
                eq(schema.shipments.id, kien.id!),
                or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
                // Nguồn hãng thắng Lark (spec ghi ngược §6).
                or(isNull(schema.shipments.deliverySource), sql`${schema.shipments.deliverySource} NOT IN ${NGUON_HANG}`),
                ...notYetShippedGuard,
              ));
              deliveryFrozen += (res as { rowCount?: number }).rowCount ?? 0;
            }
            // Row ĐÃ delivered nhưng thiếu ngày → lấp ngày, không đổi status.
            if (laDelivered && canLapNgay(mot)) {
              await tx.update(schema.shipments)
                .set({ deliveredAt: resolveDeliveredAt(s), updatedAt: sql`now()` })
                .where(and(
                  eq(schema.shipments.id, kien.id!),
                  eq(schema.shipments.deliveryStatus, 'delivered'),
                  isNull(schema.shipments.deliveredAt),
                  or(isNull(schema.shipments.deliverySource), sql`${schema.shipments.deliverySource} NOT IN ${NGUON_HANG}`),
                ));
            }
            // TỰ CHỮA LÀNH: ops điền "Ngày giao thực tế" MUỘN → sửa lại theo ngày thực. CHỈ đè
            // nguồn 'lark' — POD bill carrier (D-019) và FedEx track không bị đụng. Cũng chính
            // bước này sửa các kiện tách đơn đã bị gán nhầm ngày của kiện cuối.
            if (laDelivered && s.actualDeliveredAt && canSuaNgay(mot, s.actualDeliveredAt)) {
              await tx.update(schema.shipments)
                .set({ deliveredAt: s.actualDeliveredAt, updatedAt: sql`now()` })
                .where(and(
                  eq(schema.shipments.id, kien.id!),
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
    const summary: LarkSyncSummary = { created: cls.create.length, updated: canUpdate.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings, larkStatusUpserted, qcUpserted, deliveryFrozen, boQuaKhongDoi: boQuaUpdate + boQuaStatus, ...(opts?.giuRecords ? { records } : {}) };

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
