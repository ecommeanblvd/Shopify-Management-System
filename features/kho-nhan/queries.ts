/** Truy vấn cho màn "Nhận hàng & KCS": món của đơn + việc đã làm hôm nay. */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface MonCuaDon {
  dinhDanh: string;
  recordId: string | null;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  huy: boolean;
  lyDoHuy: string | null;
  /** Kết quả kho đã ghi cho món này (nếu có) — nhập tiếp là SỬA, không tạo dòng hai. */
  daNhan: { luc: string; qcCheck: string; whAction: string; soLuong: number; canKg: number | null; trangThaiDay: string } | null;
}

export async function timMonCuaDon(orderNumber: string): Promise<MonCuaDon[]> {
  const bare = orderNumber.trim().replace(/^#/, '');
  if (!bare) return [];
  const m = schema.larkMonDon, w = schema.whNhanKcs;
  const rows = await db.select({
    dinhDanh: m.dinhDanh, recordId: m.recordId, sku: m.sku, lineitemName: m.lineitemName,
    store: m.store, vendor: m.vendor, huy: m.huy, lyDoHuy: m.lyDo,
    wLuc: w.luc, wQc: w.qcCheck, wAction: w.whAction, wSl: w.soLuong, wCan: w.canKg, wTrangThai: w.trangThaiDay,
  }).from(m)
    .leftJoin(w, eq(w.monDinhDanh, m.dinhDanh))
    .where(eq(m.orderNumber, bare))
    .orderBy(m.sku);

  return rows.map((r) => ({
    dinhDanh: r.dinhDanh, recordId: r.recordId, sku: r.sku, lineitemName: r.lineitemName,
    store: r.store, vendor: r.vendor, huy: r.huy, lyDoHuy: r.lyDoHuy,
    daNhan: r.wLuc
      ? { luc: r.wLuc.toISOString(), qcCheck: r.wQc!, whAction: r.wAction!, soLuong: r.wSl!, canKg: r.wCan != null ? Number(r.wCan) : null, trangThaiDay: r.wTrangThai! }
      : null,
  }));
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
