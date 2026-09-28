'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { quoteOrderAcrossCarriers } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { assignOrderCarrier } from '@/features/shopify-orders/carrier-select-actions';
import { kiemDongKien, type DongKienVao } from './dong-kien';
import { xepQuote } from './logic';
import { thoiGianGiaoTheoHang } from './thoi-gian-giao';
import type { BaoGiaKien } from './types';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, BaoGiaKien>();

/** Báo giá MỘT kiện qua mọi hãng theo cân thực + kích thước kiện (không phải cân đơn). Cache 10 phút. */
export async function baoGiaKien(shipmentId: string): Promise<BaoGiaKien> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { rows: [], reNhatKey: null, thoiGian: {}, theoDuKien: false, error: 'Chưa đăng nhập', luc: new Date().toISOString() };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_fulfillment')) return { rows: [], reNhatKey: null, thoiGian: {}, theoDuKien: false, error: 'Không có quyền', luc: new Date().toISOString() };

  const [k] = await db.select({
    weightKg: schema.shipments.actualWeightKg, l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
    labelCreatedAt: schema.shipments.labelCreatedAt, createdAt: schema.shipments.createdAt,
    country: schema.shopifyOrders.shipCountry, postcode: schema.shopifyOrders.shipPostcode, city: schema.shopifyOrders.shipCity, addrClass: schema.shopifyOrders.addrClass,
    canDuKien: schema.shopifyOrders.shipWeightKg, canDuKienSua: schema.shopifyOrders.shipWeightKgOverride,
  }).from(schema.shipments).innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(eq(schema.shipments.id, shipmentId)).limit(1);
  const luc = new Date().toISOString();
  if (!k) return { rows: [], reNhatKey: null, thoiGian: {}, theoDuKien: false, error: 'Không tìm thấy kiện', luc };
  // Chưa đóng gói thì so cước bằng cân dự kiến Shopify — quy trình là chọn line trước khi đóng.
  const canThuc = k.weightKg != null ? Number(k.weightKg) : null;
  const canDuKien = Number(k.canDuKienSua ?? k.canDuKien) || null;
  const weightKg = canThuc ?? canDuKien;
  const theoDuKien = canThuc == null && canDuKien != null;
  if (!k.country || !weightKg) {
    return { rows: [], reNhatKey: null, thoiGian: {}, theoDuKien: false, error: 'Kiện thiếu nước hoặc cân — chưa so cước được', luc };
  }
  const dims = k.l != null && k.w != null && k.h != null ? { lengthCm: Number(k.l), widthCm: Number(k.w), heightCm: Number(k.h) } : null;

  const key = `${shipmentId}|${weightKg}|${theoDuKien ? 'dk' : 'thuc'}|${dims ? `${dims.lengthCm}x${dims.widthCm}x${dims.heightCm}` : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - new Date(hit.luc).getTime() < CACHE_MS) return hit;

  const [rows, thoiGian] = await Promise.all([
    quoteOrderAcrossCarriers({
    country: k.country, weightKg, postcode: k.postcode, city: k.city, dimensions: dims,
    effectiveDate: k.labelCreatedAt ?? k.createdAt,
      isResidential: laNhaDan(k.addrClass, k.country),
    }),
    thoiGianGiaoTheoHang(k.country),
  ]);
  const xep = xepQuote(rows);
  const kq: BaoGiaKien = { rows: xep.rows, reNhatKey: xep.reNhatKey, thoiGian, theoDuKien, luc };
  // Không để Map phình vô hạn: quá 1.000 khoá thì xoá hết (cache chỉ là tiện, không phải nguồn sự thật).
  if (cache.size > 1000) cache.clear();
  cache.set(key, kq);
  return kq;
}

/** Chọn hãng cho ĐƠN (áp cho mọi kiện của đơn — Lark ghi mọi dòng của đơn). Cần manage_fulfillment. */
export async function chonHangChoDon(orderId: string, carrierKey: string): Promise<Awaited<ReturnType<typeof assignOrderCarrier>>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'chon_line_ship')) return { ok: false, error: 'Không có quyền chọn line ship' };
  const r = await assignOrderCarrier(orderId, carrierKey);
  revalidatePath('/f/dong-hang');
  return r;
}

/** Người đang đăng nhập nếu có quyền đóng/mở kiện; ngược lại trả lý do từ chối. */
async function nguoiDuocDongKien(): Promise<{ id: string } | { loi: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { loi: 'Chưa đăng nhập.' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_fulfillment')) return { loi: 'Không có quyền đóng kiện.' };
  return { id: session.user.id };
}

const duongDongHang = () => revalidatePath('/f/dong-hang');

/**
 * ĐÓNG một kiện sẽ không bao giờ có vận đơn — giao tận tay, dòng trùng, đơn huỷ
 * (CEO 28/09/2026). Kiện rời hàng chờ nhưng KHÔNG bị xoá: vẫn xem được ở ngăn
 * "Đã đóng" và ở "Tất cả", kèm lý do và người đóng.
 */
export async function dongKienKhongVanDon(
  shipmentId: string, vao: DongKienVao,
): Promise<{ ok: boolean; loi?: string }> {
  const ai = await nguoiDuocDongKien();
  if ('loi' in ai) return { ok: false, loi: ai.loi };

  const [kien] = await db.select({
    logUniqueCode: schema.shipments.logUniqueCode,
    trackingNumber: schema.shipments.trackingNumber,
  }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!kien) return { ok: false, loi: 'Không thấy kiện.' };
  // Kiện ĐÃ có vận đơn thì không phải việc của lối này — đóng nó là che mất một
  // kiện đang đi thật.
  if (kien.trackingNumber) return { ok: false, loi: 'Kiện đã có vận đơn, không cần đóng tay.' };

  const loi = kiemDongKien(vao, kien.logUniqueCode);
  if (loi) return { ok: false, loi };

  try {
    await db.update(schema.shipments).set({
      dongKienLuc: new Date(),
      dongKienLyDo: vao.lyDo,
      dongKienGhiChu: vao.ghiChu?.trim() || null,
      dongKienKienThayThe: vao.lyDo === 'dong_trung' ? vao.kienThayThe!.trim() : null,
      dongKienBy: ai.id,
      updatedAt: new Date(),
    }).where(eq(schema.shipments.id, shipmentId));
    duongDongHang();
    return { ok: true };
  } catch (e) {
    console.error('[dong-hang] dongKienKhongVanDon lỗi:', e);
    return { ok: false, loi: 'Đóng kiện thất bại.' };
  }
}

/** MỞ LẠI kiện đã đóng — xoá sạch dấu vết đóng để nó quay về hàng chờ. */
export async function moLaiKien(shipmentId: string): Promise<{ ok: boolean; loi?: string }> {
  const ai = await nguoiDuocDongKien();
  if ('loi' in ai) return { ok: false, loi: ai.loi };
  try {
    await db.update(schema.shipments).set({
      dongKienLuc: null, dongKienLyDo: null, dongKienGhiChu: null,
      dongKienKienThayThe: null, dongKienBy: null, updatedAt: new Date(),
    }).where(eq(schema.shipments.id, shipmentId));
    duongDongHang();
    return { ok: true };
  } catch (e) {
    console.error('[dong-hang] moLaiKien lỗi:', e);
    return { ok: false, loi: 'Mở lại kiện thất bại.' };
  }
}
