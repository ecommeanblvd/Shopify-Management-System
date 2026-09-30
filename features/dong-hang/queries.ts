/** Truy vấn màn "Đóng hàng": mỗi dòng một kiện Lark (shipments có log_unique_code). */
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { inArray } from 'drizzle-orm';
import { tinhTrangHuyKien, type MonLark } from '@/features/lark/huy-mon';
import { tenNguoiDung } from './logic';
import { laDonInvalid } from './dong-kien';
import type { BoLocDongHang, KienDongHang, KienChoKhop } from './types';

/** Số kiện tối đa một lượt tải — UI báo "chỉ hiện 500 đầu" khi chạm trần để không cắt âm thầm. */
export const GIOI_HAN_KIEN = 500;
/** Chuỗi tìm kiếm vào LIKE: escape %, _ và \ để người gõ '%' không thành wildcard. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listKienDongHang(loc: BoLocDongHang, q?: string): Promise<KienDongHang[]> {
  const s = schema.shipments, o = schema.shopifyOrders, st = schema.stores, u = schema.user;
  // Ngày hiển thị: Lark đang hẹn đi ngày nào thì theo ngày đó (hold sang ngày khác vẫn đúng),
  // chưa hẹn thì lấy ngày lên nhãn, cuối cùng mới tới ngày kiện về SMS.
  const ngayDong = sql<Date>`coalesce(${s.ngayDiDuKien}, ${s.labelCreatedAt}, ${s.createdAt})`;
  /* So SÁNH BẰNG, không dùng `like '%invalid%'`: "Invalid address fixed" nghĩa ngược
     hẳn mà vẫn dính. Cờ này ĐUỔI việc ra khỏi hàng chờ nên nhận nhầm là giấu mất
     việc thật. Cùng luật với hàm thuần `laDonInvalid`, có test đối chiếu. */
  const LA_INVALID = sql`lower(trim(coalesce(${s.larkGhiChuDon}, ''))) = 'invalid'`;
  const KHONG_INVALID = sql`lower(trim(coalesce(${s.larkGhiChuDon}, ''))) <> 'invalid'`;
  const dk = [isNotNull(s.logUniqueCode)];
  // Chờ chọn line = kiện ĐÃ ĐÓNG XONG (có cân) mà chưa lên nhãn. Dòng Lark tạo sẵn từ lúc
  // lên đơn nhưng chưa đóng thì KHÔNG phải việc của màn này — kiện chưa cân cũng không so
  // cước được (CEO hỏi về #MBLVD29309, dòng tạo 07/07 chưa từng cân).
  // Chờ chọn line = mọi kiện Lark CHƯA lên nhãn, kể cả chưa đóng gói: quy trình là chọn
  // line TRƯỚC rồi mới đóng theo chuẩn bao bì của hãng đó (CEO 22/09/2026). Kiện chưa cân
  // thì so cước bằng cân dự kiến của Shopify.
  if (loc === 'cho_chon_line') {
    dk.push(isNull(s.trackingNumber));
    // Dòng Lark đã bị Ops xoá → không còn là việc phải làm (vẫn xem được ở "Tất cả").
    dk.push(isNull(s.larkMatDongLuc));
    // Ba lối RA khác của kiện không bao giờ có vận đơn (CEO 28/09/2026):
    //  • đơn Invalid — đọc thẳng từ Lark, TỰ rời và TỰ quay lại khi CX sửa xong;
    //  • đã đóng tay kèm lý do (giao tận tay, dòng trùng, đơn huỷ).
    // Thiếu hai điều kiện này thì 13/14 kiện tồn đọng nằm lại vĩnh viễn.
    dk.push(KHONG_INVALID);
    dk.push(isNull(s.dongKienLuc));
  }
  // Hai ngăn riêng để xem lại thứ đã rời hàng chờ — rời không có nghĩa là biến mất.
  if (loc === 'don_invalid') { dk.push(LA_INVALID); dk.push(isNull(s.trackingNumber)); }
  if (loc === 'da_dong') dk.push(isNotNull(s.dongKienLuc));
  // Ngày VN = UTC+7; so theo ngày-lịch VN của mốc đóng.
  if (loc === 'hom_nay') dk.push(sql`(${ngayDong} + interval '7 hours')::date = (now() + interval '7 hours')::date`);
  // Dự kiến đi: Lark hẹn ngày đi ở TƯƠNG LAI (kiện hold sang ngày khác) và chưa lên nhãn.
  if (loc === 'du_kien_di') {
    dk.push(sql`(${s.ngayDiDuKien} + interval '7 hours')::date > (now() + interval '7 hours')::date`);
    dk.push(isNull(s.trackingNumber));
  }
  if (loc === '7_ngay') dk.push(sql`${ngayDong} >= now() - interval '7 days'`);
  const tim = q?.trim();
  if (tim) dk.push(or(ilike(o.shopifyOrderNumber, `%${escapeLike(tim)}%`), ilike(s.logUniqueCode, `%${escapeLike(tim)}%`))!);

  const rows = await db.select({
    shipmentId: s.id, orderId: o.id, orderNumber: o.shopifyOrderNumber, logUniqueCode: s.logUniqueCode, storeName: st.name, country: o.shipCountry,
    weightKg: s.actualWeightKg, canDuKien: sql<string | null>`coalesce(${o.shipWeightKgOverride}, ${o.shipWeightKg})`, l: s.dimLengthCm, w: s.dimWidthCm, h: s.dimHeightCm,
    /* Đóng thùng ghi từ SMS — cột SMS sở hữu, đồng bộ Lark không đụng tới (xem migration 0187). */
    smsHop: s.smsHop, smsCan: s.smsWeightKg, smsL: s.smsDimLengthCm, smsW: s.smsDimWidthCm, smsH: s.smsDimHeightCm, smsDongLuc: s.smsPackedAt,
    /* Tổng cân DỰ KIẾN SAU ĐÓNG THÙNG của các món, kéo từ Lark về lúc QC. `count(*) - count(weight_kg)`
       đếm món THIẾU cân: thiếu một món là tổng không dùng được, và phải nói ra chứ không lặng lẽ cộng thiếu. */
    canMonTong: sql<string | null>`(SELECT SUM(gi.weight_kg) FROM goods_receipt_items gi WHERE gi.order_id = ${o.id})`,
    canMonThieu: sql<string | null>`(SELECT (COUNT(*) - COUNT(gi.weight_kg))::text FROM goods_receipt_items gi WHERE gi.order_id = ${o.id})`,
    canMonSo: sql<string | null>`(SELECT COUNT(*)::text FROM goods_receipt_items gi WHERE gi.order_id = ${o.id})`,
    base: s.originHub, ngayDiDuKien: s.ngayDiDuKien, ghiChuDon: s.larkGhiChuDon,
    dongKienLuc: s.dongKienLuc, dongKienLyDo: s.dongKienLyDo, dongKienGhiChu: s.dongKienGhiChu,
    dongKienKienThayThe: s.dongKienKienThayThe, dongKienBy: s.dongKienBy, cacDonTrongKien: s.cacDonTrongKien, larkMatDongLuc: s.larkMatDongLuc, hop: s.larkHop, skuText: s.skuText, pieces: s.pieces, trackingNumber: s.trackingNumber,
    hangKhachTra: o.shippingCarrierKey, selectedCarrierKey: o.selectedCarrierKey, selectedCarrierBy: o.selectedCarrierBy, tenNguoiChon: u.name, selectedCarrierAt: o.selectedCarrierAt,
    ngayDong,
    soKienCungDon: sql<number>`(select count(*)::int from shipments s2 where s2.order_id = ${o.id} and s2.log_unique_code is not null)`,
  }).from(s).innerJoin(o, eq(o.id, s.orderId)).innerJoin(st, eq(st.id, o.storeId))
    // Tên người chọn line: tài khoản lưu email, người đọc cần TÊN (CEO 22/09/2026).
    .leftJoin(u, eq(u.email, o.selectedCarrierBy))
    .where(and(...dk)).orderBy(desc(ngayDong), desc(s.createdAt)).limit(GIOI_HAN_KIEN);

  // Món đã huỷ của ĐÚNG những đơn đang hiện — kiện đã đóng vẫn có thể bị huỷ sau đó.
  const soDon = [...new Set(rows.map((r) => r.orderNumber.replace(/^#/, '')))];
  const monTheoDon = new Map<string, MonLark[]>();
  if (soDon.length > 0) {
    const m = schema.larkMonDon;
    const mon = await db.select().from(m).where(inArray(m.orderNumber, soDon));
    for (const x of mon) {
      const l = monTheoDon.get(x.orderNumber) ?? [];
      l.push({
        dinhDanh: x.dinhDanh, recordId: x.recordId ?? '', orderNumber: x.orderNumber, sku: x.sku,
        lineitemName: x.lineitemName, store: x.store, vendor: x.vendor, huy: x.huy, lyDo: x.lyDo,
      });
      monTheoDon.set(x.orderNumber, l);
    }
  }

  return rows.map((r) => ({
    shipmentId: r.shipmentId, orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName, country: r.country,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null,
    canDuKienKg: r.canDuKien != null ? Number(r.canDuKien) : null,
    dongThung: r.smsDongLuc != null ? {
      hop: r.smsHop, canKg: r.smsCan != null ? Number(r.smsCan) : null,
      dims: r.smsL != null && r.smsW != null && r.smsH != null
        ? { l: Number(r.smsL), w: Number(r.smsW), h: Number(r.smsH) } : null,
      luc: r.smsDongLuc.toISOString(),
    } : null,
    canMon: {
      tongKg: r.canMonTong != null ? Number(r.canMonTong) : null,
      soMonThieuCan: Number(r.canMonThieu ?? 0),
      soMon: Number(r.canMonSo ?? 0),
    },
    dims: r.l != null && r.w != null ? { l: Number(r.l), w: Number(r.w), h: r.h != null ? Number(r.h) : null } : null,
    logUniqueCode: r.logUniqueCode ?? null,
    base: r.base, theoHenLark: r.ngayDiDuKien != null,
    ghiChuDon: r.ghiChuDon ?? null,
    donInvalid: laDonInvalid(r.ghiChuDon),
    dong: r.dongKienLuc == null ? null : {
      luc: r.dongKienLuc.toISOString(), lyDo: r.dongKienLyDo ?? 'khac',
      ghiChu: r.dongKienGhiChu ?? null, kienThayThe: r.dongKienKienThayThe ?? null,
      boi: r.dongKienBy ?? null,
    }, donDiChung: (r.cacDonTrongKien ?? []).filter((d) => d.replace(/^#/, '') !== r.orderNumber.replace(/^#/, '')), hop: r.hop, skuText: r.skuText, pieces: r.pieces, trackingNumber: r.trackingNumber, hangKhachTra: r.hangKhachTra,
    larkMatDong: r.larkMatDongLuc != null,
    huy: tinhTrangHuyKien(r.skuText, monTheoDon.get(r.orderNumber.replace(/^#/, '')) ?? []),
    selectedCarrierKey: r.selectedCarrierKey, selectedCarrierBy: tenNguoiDung(r.tenNguoiChon, r.selectedCarrierBy),
    selectedCarrierAt: r.selectedCarrierAt ? r.selectedCarrierAt.toISOString() : null,
    ngayDong: new Date(r.ngayDong).toISOString(), soKienCungDon: Number(r.soKienCungDon),
  }));
}

/** Số kiện Lark chưa lên nhãn mà CHƯA CÓ CÂN THỰC — đang so cước bằng cân dự kiến Shopify. */
export async function demKienChuaCan(): Promise<number> {
  const s = schema.shipments;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s)
    .where(and(isNotNull(s.logUniqueCode), isNull(s.trackingNumber), isNull(s.actualWeightKg), isNull(s.larkMatDongLuc)));
  return Number(r?.n ?? 0);
}

export async function listKienChoKhop(): Promise<KienChoKhop[]> {
  const t = schema.larkPackChoKhop;
  // Chỉ 14 ngày gần nhất: dòng Lark ghi sai mã đơn không được treo đỏ mãi trên màn.
  const rows = await db.select().from(t).where(sql`${t.nhanLuc} >= now() - interval '14 days'`).orderBy(desc(t.nhanLuc)).limit(200);
  return rows.map((r) => ({
    recordId: r.recordId, logUniqueCode: r.logUniqueCode, orderNumber: r.orderNumber,
    weightKg: r.weightKg != null ? Number(r.weightKg) : null,
    dims: r.dims, hop: r.hop, skuText: r.skuText, pieces: r.pieces,
    lyDo: r.lyDo, nhanLuc: r.nhanLuc.toISOString(),
  }));
}
