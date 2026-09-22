/** Truy vấn màn "Đóng hàng": mỗi dòng một kiện Lark (shipments có log_unique_code). */
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { BoLocDongHang, KienDongHang, KienChoKhop } from './types';

/** Số kiện tối đa một lượt tải — UI báo "chỉ hiện 500 đầu" khi chạm trần để không cắt âm thầm. */
export const GIOI_HAN_KIEN = 500;
/** Chuỗi tìm kiếm vào LIKE: escape %, _ và \ để người gõ '%' không thành wildcard. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listKienDongHang(loc: BoLocDongHang, q?: string): Promise<KienDongHang[]> {
  const s = schema.shipments, o = schema.shopifyOrders, st = schema.stores;
  const ngayDong = sql<Date>`coalesce(${s.labelCreatedAt}, ${s.createdAt})`;
  const dk = [isNotNull(s.logUniqueCode)];
  if (loc === 'chua_tracking') dk.push(isNull(s.trackingNumber));
  // Ngày VN = UTC+7; so theo ngày-lịch VN của mốc đóng.
  if (loc === 'hom_nay') dk.push(sql`(${ngayDong} + interval '7 hours')::date = (now() + interval '7 hours')::date`);
  if (loc === '7_ngay') dk.push(sql`${ngayDong} >= now() - interval '7 days'`);
  const tim = q?.trim();
  if (tim) dk.push(or(ilike(o.shopifyOrderNumber, `%${escapeLike(tim)}%`), ilike(s.logUniqueCode, `%${escapeLike(tim)}%`))!);

  const rows = await db.select({
    shipmentId: s.id, orderId: o.id, orderNumber: o.shopifyOrderNumber, storeName: st.name, country: o.shipCountry,
    weightKg: s.actualWeightKg, l: s.dimLengthCm, w: s.dimWidthCm, h: s.dimHeightCm,
    base: s.originHub, hop: s.larkHop, skuText: s.skuText, pieces: s.pieces, trackingNumber: s.trackingNumber,
    hangKhachTra: o.shippingCarrierKey, selectedCarrierKey: o.selectedCarrierKey, selectedCarrierBy: o.selectedCarrierBy, selectedCarrierAt: o.selectedCarrierAt,
    ngayDong,
    soKienCungDon: sql<number>`(select count(*)::int from shipments s2 where s2.order_id = ${o.id} and s2.log_unique_code is not null)`,
  }).from(s).innerJoin(o, eq(o.id, s.orderId)).innerJoin(st, eq(st.id, o.storeId))
    .where(and(...dk)).orderBy(desc(ngayDong), desc(s.createdAt)).limit(GIOI_HAN_KIEN);

  return rows.map((r) => ({
    shipmentId: r.shipmentId, orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName, country: r.country,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null,
    dims: r.l != null && r.w != null ? { l: Number(r.l), w: Number(r.w), h: r.h != null ? Number(r.h) : null } : null,
    base: r.base, hop: r.hop, skuText: r.skuText, pieces: r.pieces, trackingNumber: r.trackingNumber, hangKhachTra: r.hangKhachTra,
    selectedCarrierKey: r.selectedCarrierKey, selectedCarrierBy: r.selectedCarrierBy,
    selectedCarrierAt: r.selectedCarrierAt ? r.selectedCarrierAt.toISOString() : null,
    ngayDong: new Date(r.ngayDong).toISOString(), soKienCungDon: Number(r.soKienCungDon),
  }));
}

export async function listKienChoKhop(): Promise<KienChoKhop[]> {
  const t = schema.larkPackChoKhop;
  // Chỉ 14 ngày gần nhất: dòng Lark ghi sai mã đơn không được treo đỏ mãi trên màn.
  const rows = await db.select().from(t).where(sql`${t.nhanLuc} >= now() - interval '14 days'`).orderBy(desc(t.nhanLuc)).limit(200);
  return rows.map((r) => ({
    recordId: r.recordId, logUniqueCode: r.logUniqueCode, orderNumber: r.orderNumber,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null, dims: r.dims, hop: r.hop, skuText: r.skuText, pieces: r.pieces,
    lyDo: r.lyDo, nhanLuc: r.nhanLuc.toISOString(),
  }));
}
