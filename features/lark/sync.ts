/**
 * Orchestrate sync Lark → shipments. Một lõi cho cả nút thủ công + cron.
 * One-way. Ghi đè field shipment chỉ khi Lark có giá trị. Idempotent.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords } from './client';
import { parsePackRow, type PackRow } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps } from './classify';
import { resolveOrderIds } from '@/features/shipments/import-actions';

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
  unmatched: Array<{ orderNumber: string; reason: string }>;
  skipped: number; warnings: string[];
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
    const existing = await db
      .select({ id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode, trackingNumber: schema.shipments.trackingNumber })
      .from(schema.shipments);
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
    for (const batch of chunk(cls.update, APPLY_CHUNK)) {
      await db.transaction(async (tx) => {
        for (const u of batch) {
          const patch = patchFrom(u.row);
          if (Object.keys(patch).length > 1) await tx.update(schema.shipments).set(patch).where(eq(schema.shipments.id, u.shipmentId));
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

    const warnings = rows.flatMap((r) => r.warnings.map((w) => `${r.orderNumber || r.logUniqueCode}: ${w}`));
    const summary: LarkSyncSummary = { created: cls.create.length, updated: cls.update.length, unmatched: cls.unmatched, skipped: cls.skipped.length, warnings };

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
