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
import { getLogRecordById, getTenHopVtdg, searchRecordsByLogCode, searchRecordsByOrderNumber } from './client';
import { parsePackRow, tenHopGon } from './parse-pack-row';
import { coDonNay } from './push-courier';
import type { CachNhanDien } from './pack-webhook/xac-thuc';
import { classifyPackRows, type ClassifyMaps, type ClassifyResult } from './classify';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import { resolveOrderIds } from '@/features/shipments/import-actions';
import { coThayDoi } from '@/lib/khong-doi';
import type { PackRow } from './parse-pack-row';

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

/** Ghi (upsert) dòng Lark vào bảng chờ khớp để màn Đóng hàng hiện đỏ. */
async function ghiChoKhop(recordId: string, row: PackRow, lyDo: string): Promise<void> {
  const gt = {
    logUniqueCode: row.logUniqueCode, orderNumber: row.orderNumber,
    weightKg: row.weightKg != null ? String(row.weightKg) : null,
    dims: row.dims ? `${row.dims.l}x${row.dims.w}${row.dims.h != null ? `x${row.dims.h}` : ''}` : null,
    hop: row.hop, skuText: row.skuText, pieces: row.pieces, lyDo, nhanLuc: new Date(),
  };
  await db.insert(schema.larkPackChoKhop).values({ recordId, ...gt })
    .onConflictDoUpdate({ target: schema.larkPackChoKhop.recordId, set: gt });
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
  // bo_qua thì cũng gỡ dòng chờ khớp cũ của record này (Ops xoá record / xoá Order Number).
  const boQua = async (logUniqueCode: string | null, lyDo: string): Promise<KetQuaNhanDong> => {
    if (!dry) await db.delete(schema.larkPackChoKhop).where(eq(schema.larkPackChoKhop.recordId, recordId));
    return { ketQua: 'bo_qua', logUniqueCode, lyDo };
  };
  if (!rec) return boQua(null, 'record không còn trên Lark');

  const row = parsePackRow(rec.fields);
  // Tên hộp nằm ở bảng kho, cột "Select VTĐG1" chỉ có mã liên kết. Best-effort: hỏng thì
  // kiện vẫn về, chỉ thiếu tên hộp (ô chỉ để Đức nhìn, không dùng để tính cước).
  if (!row.hop && row.hopRecordId) row.hop = tenHopGon(await getTenHopVtdg(row.hopRecordId));
  if (!row.logUniqueCode) return boQua(null, 'dòng chưa có Log Unique code');
  if (!row.orderNumber) return boQua(row.logUniqueCode, 'dòng chưa có Order Number');

  // Map đối chiếu chỉ cho dòng này (cron nạp cả bảng; ở đây 1 dòng → 2 truy vấn nhỏ).
  const dieuKien = row.trackingNumber
    ? or(eq(schema.shipments.logUniqueCode, row.logUniqueCode), eq(schema.shipments.trackingNumber, row.trackingNumber))
    : eq(schema.shipments.logUniqueCode, row.logUniqueCode);
  // Nạp CẢ các cột patchFrom sẽ ghi → bỏ được lệnh UPDATE không đổi gì (giống cron).
  const daCo = await db.select({
    id: schema.shipments.id, logUniqueCode: schema.shipments.logUniqueCode,
    trackingNumber: schema.shipments.trackingNumber,
    actualWeightKg: schema.shipments.actualWeightKg,
    dimLengthCm: schema.shipments.dimLengthCm, dimWidthCm: schema.shipments.dimWidthCm,
    dimHeightCm: schema.shipments.dimHeightCm,
    carrierKey: schema.shipments.carrierKey, labelCreatedAt: schema.shipments.labelCreatedAt,
    larkHop: schema.shipments.larkHop, originHub: schema.shipments.originHub, ngayDiDuKien: schema.shipments.ngayDiDuKien, cacDonTrongKien: schema.shipments.cacDonTrongKien, skuText: schema.shipments.skuText, pieces: schema.shipments.pieces,
  }).from(schema.shipments).where(dieuKien);
  const kienTheoId = new Map<string, Record<string, unknown>>(daCo.map((s) => [s.id, s as Record<string, unknown>]));
  const maps: ClassifyMaps = { shipmentByLogCode: new Map(), shipmentByTracking: new Map(), orderIdByNumber: await resolveOrderIds([row.orderNumber]) };
  for (const s of daCo) {
    if (s.logUniqueCode) maps.shipmentByLogCode.set(s.logUniqueCode, s.id);
    if (s.trackingNumber) maps.shipmentByTracking.set(s.trackingNumber, s.id);
  }
  const pl = docKetQuaPhanLoai(classifyPackRows([row], maps));

  if (pl.loai === 'skipped') return { ketQua: 'bo_qua', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  if (pl.loai === 'unmatched') {
    if (!dry) await ghiChoKhop(recordId, row, pl.lyDo);
    return { ketQua: 'khong_khop', logUniqueCode: row.logUniqueCode, lyDo: pl.lyDo };
  }
  if (dry) {
    return pl.loai === 'update'
      ? { ketQua: 'cap_nhat', shipmentId: pl.shipmentId, logUniqueCode: row.logUniqueCode }
      : { ketQua: 'tao', shipmentId: '(dry)', logUniqueCode: row.logUniqueCode };
  }

  /** Ghi patch lên kiện đã có — bỏ qua lệnh nếu không đổi gì (giống cron). */
  async function vaKien(id: string, hienTai?: Record<string, unknown>): Promise<void> {
    const patch = patchFrom(row);
    if (Object.keys(patch).length > 1 && coThayDoi(hienTai, patch)) {
      await db.update(schema.shipments).set(patch).where(eq(schema.shipments.id, id));
    }
  }

  let shipmentId: string;
  let ketQua: 'tao' | 'cap_nhat';
  if (pl.loai === 'update') {
    await vaKien(pl.shipmentId, kienTheoId.get(pl.shipmentId));
    shipmentId = pl.shipmentId; ketQua = 'cap_nhat';
  } else {
    const [ins] = await db.insert(schema.shipments).values(giaTriTaoKien(row, pl.orderId)).onConflictDoNothing().returning({ id: schema.shipments.id });
    if (ins) { shipmentId = ins.id; ketQua = 'tao'; }
    else {
      // Đụng unique (log code hoặc tracking) — request song song / cron vừa tạo.
      // Tìm lại kiện theo log code rồi vá như nhánh update.
      const [s] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.logUniqueCode, row.logUniqueCode)).limit(1);
      if (!s) {
        // Không có kiện nào mang log code này → xung đột là ở tracking_number của
        // kiện KHÁC. Không tự ý vá kiện đó; để dòng chờ khớp cho người xử lý.
        const lyDo = `mã vận đơn ${row.trackingNumber} đã thuộc kiện khác`;
        await ghiChoKhop(recordId, row, lyDo);
        return { ketQua: 'khong_khop', logUniqueCode: row.logUniqueCode, lyDo };
      }
      await vaKien(s.id);
      shipmentId = s.id; ketQua = 'cap_nhat';
    }
  }
  await db.delete(schema.larkPackChoKhop).where(eq(schema.larkPackChoKhop.recordId, recordId));
  return { ketQua, shipmentId, logUniqueCode: row.logUniqueCode };
}

/**
 * Nhận dòng Lark theo cách Lark gửi được: record_id, mã kiện, hoặc MÃ ĐƠN.
 *
 * Một mã đơn có thể ứng với nhiều dòng (đơn tách nhiều kiện) nên trả về mảng kết quả.
 * Rule Lark chỉ chắc chắn chèn được giá trị các cột, không phải lúc nào cũng có record_id.
 */
export async function nhanTheoNhanDien(nd: CachNhanDien, opts?: { dry?: boolean }): Promise<KetQuaNhanDong[]> {
  if (nd.kieu === 'record') return [await nhanMotDongLark(nd.giaTri, opts)];

  let recs;
  try {
    recs = nd.kieu === 'log_code'
      ? await searchRecordsByLogCode(nd.giaTri)
      : (await searchRecordsByOrderNumber(nd.giaTri)).filter((r) => coDonNay(r.fields, nd.giaTri));
  } catch (e) {
    throw new LoiLarkApi(e instanceof Error ? e.message : String(e));
  }
  if (recs.length === 0) {
    return [{ ketQua: 'bo_qua', logUniqueCode: null, lyDo: `không thấy dòng Lark nào cho ${nd.kieu === 'don' ? 'đơn' : 'mã kiện'} ${nd.giaTri}` }];
  }
  const out: KetQuaNhanDong[] = [];
  for (const r of recs) out.push(await nhanMotDongLark(r.record_id, opts));
  return out;
}
