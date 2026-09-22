/**
 * Nhận MỘT dòng Lark LOG-Export (webhook /api/lark/pack) và ghi vào shipments bằng
 * ĐÚNG luật của cron sync-lark: parsePackRow → classifyPackRows → patchFrom/giaTriTaoKien.
 * Không tin dữ liệu Lark gửi kèm — đọc lại record theo record_id.
 *
 * Idempotent: khớp theo log_unique_code → lần bắn lại là 'cap_nhat'. Hai request cùng
 * record_id chạy đồng thời dùng chung một Promise (khoá trong tiến trình) + onConflictDoNothing.
 */
import { eq, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLogRecordById } from './client';
import { parsePackRow } from './parse-pack-row';
import { classifyPackRows, type ClassifyMaps, type ClassifyResult } from './classify';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import { resolveOrderIds } from '@/features/shipments/import-actions';

export type KetQuaNhanDong =
  | { ketQua: 'tao' | 'cap_nhat'; shipmentId: string; logUniqueCode: string | null }
  | { ketQua: 'khong_khop' | 'bo_qua'; logUniqueCode: string | null; lyDo: string };

/** Lark API lỗi/timeout — route trả 502 để Lark thử lại. */
export class LoiLarkApi extends Error {}

export type PhanLoaiMotDong =
  | { loai: 'update'; shipmentId: string }
  | { loai: 'create'; orderId: string }
  | { loai: 'unmatched'; lyDo: string }
  | { loai: 'skipped'; lyDo: string };

/** THUẦN: kết quả classifyPackRows cho đúng MỘT dòng → một nhánh. */
export function docKetQuaPhanLoai(cls: ClassifyResult): PhanLoaiMotDong {
  if (cls.update[0]) return { loai: 'update', shipmentId: cls.update[0].shipmentId };
  if (cls.create[0]) return { loai: 'create', orderId: cls.create[0].orderId };
  if (cls.unmatched[0]) return { loai: 'unmatched', lyDo: cls.unmatched[0].reason };
  return { loai: 'skipped', lyDo: cls.skipped[0]?.reason ?? 'không phân loại được' };
}

const dangXuLy = new Map<string, Promise<KetQuaNhanDong>>();

export async function nhanMotDongLark(recordId: string, opts?: { dry?: boolean }): Promise<KetQuaNhanDong> {
  const dang = dangXuLy.get(recordId);
  if (dang) return dang;
  const p = xuLy(recordId, opts?.dry === true).finally(() => dangXuLy.delete(recordId));
  dangXuLy.set(recordId, p);
  return p;
}

async function xuLy(recordId: string, dry: boolean): Promise<KetQuaNhanDong> {
  let rec: Awaited<ReturnType<typeof getLogRecordById>>;
  try { rec = await getLogRecordById(recordId); }
  catch (e) { throw new LoiLarkApi(e instanceof Error ? e.message : String(e)); }
  if (!rec) return { ketQua: 'bo_qua', logUniqueCode: null, lyDo: 'record không còn trên Lark' };

  const row = parsePackRow(rec.fields);
  if (!row.logUniqueCode) return { ketQua: 'bo_qua', logUniqueCode: null, lyDo: 'dòng chưa có Log Unique code' };
  if (!row.orderNumber) return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: 'dòng chưa có Order Number' };

  // Map đối chiếu chỉ cho dòng này (cron nạp cả bảng; ở đây 1 dòng → 2 truy vấn nhỏ).
  const dieuKien = row.trackingNumber
    ? or(eq(schema.shipments.logUniqueCode, row.logUniqueCode), eq(schema.shipments.trackingNumber, row.trackingNumber))
    : eq(schema.shipments.logUniqueCode, row.logUniqueCode);
  const daCo = await db.select({ id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode, trackingNumber: schema.shipments.trackingNumber })
    .from(schema.shipments).where(dieuKien);
  const maps: ClassifyMaps = { shipmentByLogCode: new Map(), shipmentByTracking: new Map(), orderIdByNumber: await resolveOrderIds([row.orderNumber]) };
  for (const s of daCo) {
    if (s.logUniqueCode) maps.shipmentByLogCode.set(s.logUniqueCode, s.id);
    if (s.trackingNumber) maps.shipmentByTracking.set(s.trackingNumber, s.id);
  }
  const pl = docKetQuaPhanLoai(classifyPackRows([row], maps));

  if (pl.loai === 'skipped') return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  if (pl.loai === 'unmatched') {
    if (!dry) {
      const gt = {
        logUniqueCode: row.logUniqueCode, orderNumber: row.orderNumber,
        weightKg: row.weightKg != null ? String(row.weightKg) : null,
        dims: row.dims ? `${row.dims.l}x${row.dims.w}${row.dims.h != null ? `x${row.dims.h}` : ''}` : null,
        hop: row.hop, skuText: row.skuText, pieces: row.pieces, lyDo: pl.lyDo, nhanLuc: new Date(),
      };
      await db.insert(schema.larkPackChoKhop).values({ recordId, ...gt })
        .onConflictDoUpdate({ target: schema.larkPackChoKhop.recordId, set: gt });
    }
    return { ketQua: 'khong_khop', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  }
  if (dry) {
    return pl.loai === 'update'
      ? { ketQua: 'cap_nhat', shipmentId: pl.shipmentId, logUniqueCode: row.logUniqueCode }
      : { ketQua: 'tao', shipmentId: '(dry)', logUniqueCode: row.logUniqueCode };
  }

  let shipmentId: string;
  let ketQua: 'tao' | 'cap_nhat';
  if (pl.loai === 'update') {
    await db.update(schema.shipments).set(patchFrom(row)).where(eq(schema.shipments.id, pl.shipmentId));
    shipmentId = pl.shipmentId; ketQua = 'cap_nhat';
  } else {
    const [ins] = await db.insert(schema.shipments).values(giaTriTaoKien(row, pl.orderId)).onConflictDoNothing().returning({ id: schema.shipments.id });
    if (ins) { shipmentId = ins.id; ketQua = 'tao'; }
    else {
      // Đụng unique tracking (request song song vừa tạo) → tìm lại kiện theo log code.
      const [s] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.logUniqueCode, row.logUniqueCode)).limit(1);
      if (!s) return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: 'không tạo được kiện (đụng mã vận đơn đã có)' };
      shipmentId = s.id; ketQua = 'cap_nhat';
    }
  }
  await db.delete(schema.larkPackChoKhop).where(eq(schema.larkPackChoKhop.recordId, recordId));
  return { ketQua, shipmentId, logUniqueCode: row.logUniqueCode };
}
