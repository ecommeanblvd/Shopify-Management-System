'use server';

import { eq, or, sql } from 'drizzle-orm';
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
import { kiemNhapDongThung, kiemBox, type NhapDongThung } from './dong-thung';
import type { LoaiBox } from './danh-muc-box';
import { canhBaoLechHang, kiemTraTracking } from './luu-tracking';
import { macVanDonTu } from './ma-van-don';
import { ghiGiaUocTinhLenLark } from './ghi-gia-uoc-tinh-len-lark';
import { ghiCanDimLenLark } from './ghi-can-dim-len-lark';
import { layGiaUocTinh } from './lay-gia-uoc-tinh';
import { xemTruocGhiGia } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';
import { getLogRecordById } from '@/features/lark/client';
import type { KetQuaPhanTichVanDon } from './xem-truoc-van-don';
import { xepQuote } from './logic';
import { thoiGianGiaoTheoHang } from './thoi-gian-giao';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { locThuocTinh, type MetafieldTho } from '@/features/kho-nhan/thuoc-tinh-shopify';
import { verifyAndStoreOrderAddress } from '@/features/shopify-orders/address-verify';
import { docNenVanDon } from './queries';
import { dungKhoiVanDon, type Khoi } from './van-don';
import { ghiVoi } from '@/features/nhat-ky/ghi-voi';
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

/**
 * Ghi kết quả ĐÓNG THÙNG: thùng đã dùng + cân cả kiện + kích thước (CEO 30/09/2026).
 *
 * Ghi vào cột SMS SỞ HỮU (`sms_*`), KHÔNG ghi vào `lark_hop`/`actual_weight_kg`: hai cột kia
 * do lượt đồng bộ Lark ghi đè mỗi lượt, ghi vào đó là mất dữ liệu im lặng. Khi đội Lark làm
 * xong cột bên đó thì đẩy sang từ đây — `sms_packed_at` có index để tìm kiện chưa đẩy.
 *
 * Sau khi lưu CSDL xong mới đẩy cân/dim lên dòng Lark của kiện (`ghiCanDimLenLark`, Task 9,
 * spec §3b.3) — CỐ Ý gọi NGOÀI lệnh `db.update` phía trên, trong try/catch RIÊNG: người đóng
 * hàng đang cầm kiện trên tay, Lark sập không được làm hỏng lượt lưu cân/dim vào CSDL. Kết quả
 * (ghi được hay không, và vì sao) trả ra để giao diện báo bằng toast, không im lặng nuốt mất.
 */
export async function ghiDongThung(
  shipmentId: string, vao: NhapDongThung,
): Promise<{ ok: boolean; error?: string; loi?: string[]; canhBaoLark?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  // Ghi đóng thùng là ghi DB SMS (cân + kích thước) — việc ghi, đòi manage_fulfillment. Đo 14/10/2026:
  // 7 người, 4 vai trò: operator (3, có người đóng hàng), OC, admin đều có manage_fulfillment; vai logistics
  // (2) KHÔNG có (vì nó còn đòi fulfillment.brand_requests:edit). Logistics mất quyền này → cấp quyền trong
  // màn phân quyền, KHÔNG nới cổng ở đây.
  if (!hasPermission(role, 'manage_fulfillment')) return { ok: false, error: 'Không có quyền đóng hàng' };

  const kq = kiemNhapDongThung(vao);
  if (!kq.ok || !kq.sach) return { ok: false, loi: kq.loi };

  const r = await db.update(schema.shipments).set({
    smsHop: kq.sach.hop,
    smsWeightKg: String(kq.sach.canKg),
    smsDimLengthCm: kq.sach.dai != null ? String(kq.sach.dai) : null,
    smsDimWidthCm: kq.sach.rong != null ? String(kq.sach.rong) : null,
    smsDimHeightCm: kq.sach.cao != null ? String(kq.sach.cao) : null,
    smsPackedAt: new Date(),
    smsPackedBy: session.user.id,
  }).where(eq(schema.shipments.id, shipmentId)).returning({ id: schema.shipments.id });
  if (r.length === 0) return { ok: false, error: 'Không tìm thấy kiện' };

  revalidatePath('/f/dong-hang');

  let canhBaoLark: string | undefined;
  try {
    const g = await ghiCanDimLenLark(shipmentId);
    if (!g.daGhi || g.canhBao) canhBaoLark = g.canhBao;
  } catch (e) {
    console.error('[dong-hang] ghiDongThung: đẩy cân/dim lên Lark lỗi:', e);
    canhBaoLark = 'đẩy cân/kích thước lên Lark thất bại — đã lưu trong hệ thống, kiểm lại Lark bằng tay';
  }

  return { ok: true, canhBaoLark };
}

/** `v.loai` đến từ một server action — chữ ký TS khai `LoaiBox` không ngăn được request tay
 * gửi chuỗi khác. Cột `loai` của `box_dong_goi` là `text` THUẦN, không có CHECK — một giá trị
 * ngoài ba chữ này sẽ ghi lọt, rồi BIẾN MẤT khỏi lưới `ChonBox` không một lời báo, vì lưới chia
 * khối cứng theo đúng ba chữ này (`ChonBox.tsx`: `b.loai === 'thung'` / `'tui'`). Tham số khai
 * `unknown` (không phải `LoaiBox`) để TS không coi việc kiểm này là dư — nó so khớp CHUỖI THẬT
 * lúc chạy, không phải kiểu lúc biên dịch. */
function loaiHopLe(x: unknown): x is LoaiBox {
  return x === 'thung' || x === 'tui' || x === 'khac';
}

/**
 * LƯU một box vào danh mục `box_dong_goi` — màn `QuanLyBox` (CEO 14/10/2026, spec §3 việc 5,
 * §5 "Danh mục box").
 *
 * LUÔN đặt `sua_tay = true`, bất kể box này mới tạo hay đang sửa: đây CHÍNH LÀ cái khoá của
 * luật bản-sửa-tay-thắng (§3b.3, `tronBox`) — ai sửa ở đây là người vừa cầm cái thùng thật mà
 * đo, còn số trên Lark chỉ là chữ gõ một lần lúc nhập kho. Khoá rồi thì lượt kéo Lark sau không
 * được ghi đè nữa, chỉ còn hiện qua `lech` để người xem tự quyết.
 *
 * Khớp theo TÊN (`ten`, UNIQUE) — không theo `id` khi ghi: `onConflictDoUpdate` trên `ten` để
 * một box hôm nay chỉ có ở Lark (chưa có dòng `box_dong_goi`, `id = null` trên `BoxHien`) vẫn
 * tạo được dòng SMS đầu tiên của nó mà không cần biết `id` trước. Đổi TÊN một box đã có dòng SMS
 * (`v.id` khác null) thì cập nhật THEO `id` — nếu đổi theo `ten` mới, một upsert-theo-ten sẽ tạo
 * dòng mới và bỏ mồ côi dòng cũ.
 */
export async function luuBox(v: {
  id?: string; ten: string; ma: string; loai: LoaiBox;
  daiCm: number; rongCm: number; caoCm: number | null;
}): Promise<{ ok: boolean; loi?: string[] }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: ['Chưa đăng nhập'] };
  const role = await getRole(session.user.id);
  // Cùng mốc quyền với `ghiDongThung`: ghi danh mục box là ghi DB SMS, đòi `manage_fulfillment`.
  if (!hasPermission(role, 'manage_fulfillment')) return { ok: false, loi: ['Không có quyền sửa danh mục box'] };

  if (!loaiHopLe(v.loai)) return { ok: false, loi: ['Loại box không hợp lệ'] };

  const b = schema.boxDongGoi;
  // Tên của mọi box KHÁC box đang sửa — tự loại tên của chính nó ra trước khi đưa vào `kiemBox`,
  // để sửa một box mà giữ nguyên tên không bị báo "trùng tên" với chính mình.
  const dong = await db.select({ id: b.id, ten: b.ten }).from(b);
  const dsTenKhac = dong.filter((r) => r.id !== v.id).map((r) => r.ten);

  const kq = kiemBox(
    { ten: v.ten, ma: v.ma, daiCm: String(v.daiCm), rongCm: String(v.rongCm), caoCm: v.caoCm != null ? String(v.caoCm) : '' },
    dsTenKhac,
  );
  if (!kq.ok) return { ok: false, loi: kq.loi };

  const gia = {
    ten: kq.sach!.ten,
    ma: kq.sach!.ma,
    loai: v.loai,
    daiCm: String(kq.sach!.daiCm),
    rongCm: String(kq.sach!.rongCm),
    caoCm: kq.sach!.caoCm != null ? String(kq.sach!.caoCm) : null,
    suaTay: true,
    capNhatLuc: new Date(),
    nguoiSua: session.user.id,
  };

  try {
    if (v.id) {
      const r = await db.update(b).set(gia).where(eq(b.id, v.id)).returning({ id: b.id });
      if (r.length === 0) return { ok: false, loi: ['Không tìm thấy box'] };
    } else {
      await db.insert(b).values(gia).onConflictDoUpdate({ target: b.ten, set: gia });
    }
  } catch (e) {
    console.error('[dong-hang] luuBox lỗi:', e);
    return { ok: false, loi: ['Lưu box thất bại'] };
  }

  revalidatePath('/f/dong-hang');
  return { ok: true };
}

/**
 * ẨN/HIỆN một box khỏi lưới `ChonBox` — KHÔNG xoá dòng: xoá sẽ mất luôn số đã khoá bằng
 * `sua_tay`, và nếu Lark còn lô cũ cùng tên thì box "ẩn" sẽ tự mọc lại không kiểm soát
 * (`tronBox` khớp theo tên). Cùng mốc quyền `manage_fulfillment` như `luuBox`.
 */
export async function anBox(id: string, an: boolean): Promise<{ ok: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_fulfillment')) return { ok: false };

  try {
    const r = await db.update(schema.boxDongGoi).set({ an, capNhatLuc: new Date(), nguoiSua: session.user.id })
      .where(eq(schema.boxDongGoi.id, id)).returning({ id: schema.boxDongGoi.id });
    if (r.length === 0) return { ok: false };
  } catch (e) {
    console.error('[dong-hang] anBox lỗi:', e);
    return { ok: false };
  }

  revalidatePath('/f/dong-hang');
  return { ok: true };
}

const TRUY_VAN_VAN_DON = `query($id: ID!) {
  order(id: $id) {
    email
    shippingAddress { phone }
    lineItems(first: 50) { nodes {
      sku
      product { metafields(first: 50) { nodes {
        namespace key value
        reference { ... on Metaobject { displayName } }
        references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } }
}`;

interface DongShopify { sku?: string | null; product?: { metafields?: { nodes?: MetafieldTho[] } | null } | null }

const cacheVanDon = new Map<string, { khoi: Khoi[]; luc: string }>();

/**
 * Khối thông tin cho bước LÊN VẬN ĐƠN của một kiện.
 *
 * Một lượt gọi Shopify lấy đúng ba thứ CSDL không có: SĐT (bộ sync không kéo field `phone`,
 * 0/13.125 đơn), email, và chất liệu (`custom.materials_v2`). Lấy live chứ không backfill vì
 * chỉ cần đơn đang lên vận đơn, và live thì luôn là số mới nhất.
 *
 * Shopify hỏng thì KHÔNG ném: `tuShopify = null`, hộp thoại vẫn mở với địa chỉ + cân + SKU từ
 * CSDL, ô SĐT/email nói rõ "không lấy được". Đi theo đúng nguyên tắc của `layDuLieuQc` bên QC —
 * mất ảnh/thuộc tính thì mất, không chặn kho làm việc.
 */
export async function layKhoiVanDon(
  shipmentId: string,
): Promise<{ ok: true; khoi: Khoi[]; luc: string } | { ok: false; loi: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_fulfillment')) return { ok: false, loi: 'Không có quyền' };

  const hit = cacheVanDon.get(shipmentId);
  if (hit && Date.now() - new Date(hit.luc).getTime() < CACHE_MS) return { ok: true, ...hit };

  const nen = await docNenVanDon(shipmentId);
  if (!nen) return { ok: false, loi: 'Không tìm thấy kiện' };

  let tuShopify: { phone: string | null; email: string | null } | null = null;
  let theoSku = new Map<string, string | null>();
  try {
    const token = await getStoreToken(nen.storeId);
    const r = await graphqlCall({
      shopDomain: nen.shopDomain, apiVersion: nen.apiVersion, token,
      query: TRUY_VAN_VAN_DON, variables: { id: nen.shopifyOrderId },
    }) as { data?: { order?: { email?: string | null; shippingAddress?: { phone?: string | null } | null; lineItems?: { nodes?: DongShopify[] } } | null } };
    const don = r.data?.order;
    if (don) {
      tuShopify = { phone: don.shippingAddress?.phone ?? null, email: don.email ?? null };
      theoSku = new Map((don.lineItems?.nodes ?? []).map((l) => [
        (l.sku ?? '').trim(),
        locThuocTinh(l.product?.metafields?.nodes ?? []).hien.find((x) => x.nhan === 'Chất liệu')?.giaTri ?? null,
      ]));
    }
  } catch (e) {
    console.error('[dong-hang] layKhoiVanDon: Shopify lỗi:', e);
  }

  const khoi = dungKhoiVanDon({
    diaChi: nen.diaChi, tuShopify, can: nen.can, soKien: nen.soKien,
    mon: nen.mon.map((m) => ({ ...m, chatLieu: theoSku.get((m.sku ?? '').trim()) ?? null })),
  });
  const kq = { khoi, luc: new Date().toISOString() };
  cacheVanDon.set(shipmentId, kq);
  return { ok: true, ...kq };
}

/**
 * Verify lại địa chỉ NGAY tại bước lên vận đơn.
 *
 * Gác `chon_line_ship`, KHÔNG dùng `verifyOrderAddressAction` của features/fulfillment: hàm đó
 * đòi `manage_fulfillment` mà vai trò `logistics` không có. Lõi verify thì dùng lại nguyên,
 * không viết luật thứ hai.
 */
export async function verifyDiaChiKien(shipmentId: string): Promise<{ ok: boolean; loi?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'chon_line_ship')) return { ok: false, loi: 'Không có quyền verify địa chỉ' };

  const [k] = await db.select({ orderId: schema.shipments.orderId })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!k) return { ok: false, loi: 'Không tìm thấy kiện' };

  const r = await verifyAndStoreOrderAddress(k.orderId);
  // Khối đã dựng mang kết quả verify cũ — bỏ đi để lượt mở sau đọc lại.
  cacheVanDon.delete(shipmentId);
  revalidatePath('/f/dong-hang');
  return r.ok ? { ok: true } : { ok: false, loi: r.error ?? 'Verify thất bại' };
}

export type KetQuaLuuTracking =
  | { ok: true; tracking: string; giaDaGhi: boolean; canhBao?: string }
  | { ok: false; loi: string };

/** Người đang đăng nhập nếu được phép GHI mã vận đơn; ngược lại lý do từ chối.
 *
 *  Gác `tao_van_don` cho CẢ hai bước (phân tích và ghi), KHÔNG phải `view_fulfillment`:
 *  bước phân tích đã gọi API báo giá của hãng (tốn tiền, có hạn mức) và ĐỌC dòng Lark vận
 *  hành thật. Để vai trò `viewer` (chỉ-được-xem) bấm được là mở cửa cho người chỉ-xem đốt hạn
 *  mức Rate API; mà bước phân tích chỉ có nghĩa với người sắp bấm ghi, nên hai bước phải cùng
 *  một mức quyền — gác lỏng bước đầu rồi chặn ở bước sau là bày ra một nút vô dụng.
 *
 *  Quyền RIÊNG `tao_van_don`, KHÔNG phải `manage_fulfillment` như trước 21/10/2026: gác bằng
 *  `manage_fulfillment` là buộc việc nhập mã vận đơn đi chung một mức với đóng kiện, mở lại
 *  kiện và sửa danh mục box — không có cách nào cho ai nhập mã mà không cho họ sửa kiện, nên
 *  đội `logistics` (2 người, chính là người làm trên màn này) không nhập được. CEO 21/10/2026
 *  chốt logistics và operator đều được nhập, nên cổng phải là một quyền của riêng việc này.
 *
 *  ĐÂY KHÔNG PHẢI ĐƯỜNG DUY NHẤT nhập mã vận đơn, và đường kia gác bằng quyền KHÁC — CÓ CHỦ Ý:
 *  `shipPack` (`features/packing/actions.ts`, ô "Tracking number" + nút Ship trên màn
 *  `/f/lifecycle/<orderId>`) vẫn gác `manage_fulfillment`. Vì nó làm nhiều hơn ghi một mã:
 *  đóng dấu kiện đã ship, chuyển mọi dòng sang `shipped`, rồi đẩy fulfillment lên SHOPIFY
 *  kèm thông báo cho khách — tức NÓI VỚI KHÁCH là đơn đã gửi, không rút lại được, và mã sai
 *  thì khách A nhận mã của khách B. Nới rộng ai được bấm nút đó là việc phải hỏi CEO riêng,
 *  không đi kèm lượt tách quyền này (phán quyết người điều phối 21/10/2026). Hệ quả: vai
 *  `logistics` nhập được mã ở màn Đóng hàng nhưng VẪN KHÔNG ship được từ `/f/lifecycle`. */
async function nguoiDuocGhiVanDon(): Promise<{ ok: true; id: string } | { ok: false; loi: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'tao_van_don')) {
    return { ok: false, loi: 'Không có quyền tạo vận đơn.' };
  }
  // Trả luôn `id`: bước lưu mã vận đơn phải gắn danh tính vào nhật ký, và người đã
  // được gác ở đây chính là người sẽ chịu trách nhiệm cho mã đó.
  return { ok: true, id: session.user.id };
}

/**
 * Kiểm chuỗi nhân sự dán vào ô mã vận đơn — DÙNG CHUNG cho bước phân tích và bước ghi.
 *
 * Phải là MỘT hàm cho cả hai bước: nếu bước phân tích kiểm lỏng hơn, nhân sự sẽ xem xong một
 * bảng giá đẹp rồi bấm xác nhận và nhận lỗi đỏ ở bước cuối — còn nếu kiểm CHẶT hơn thì ngược
 * lại, có mã qua được bước ghi mà chưa ai xem trước. Hai bộ luật cho cùng một ô nhập là loại
 * lệch chỉ hiện ra trên tay người dùng.
 *
 * MỘT truy vấn tra cả hai việc (I5/I6, review coordinator):
 *   (a) kiện NÀY đang có mã gì — để phát hiện GHI ĐÈ lên mã đã có: kiện có T1 (Lark đã điền
 *       T1) mà nhân sự dán T2 đè lên thì DB thành T2 trong khi Lark giữ T1 — lượt đồng bộ
 *       Lark kế tiếp (`patch-kien.ts` → `patchFrom`) ghi T1 trở lại, THAO TÁC MẤT TRẮNG không
 *       một lời cảnh báo.
 *   (b) có kiện KHÁC đang dùng mã này không (Review Focus #4).
 * So khớp bằng `upper()` CẢ HAI PHÍA (I6): `macVanDonTu` luôn trả mã đã viết hoa, nhưng
 * tracking lưu trong DB có thể verbatim từ nguồn khác (vd đồng bộ Lark) — so bằng `eq()`
 * thường bỏ lọt mã viết thường ở kiện khác.
 */
async function kiemMaChoKien(
  shipmentId: string, raw: string,
): Promise<{ ok: true; tracking: string; carrierKey: string | null } | { ok: false; loi: string }> {
  // Bóc tạm để tra trùng — kiemTraTracking bóc LẠI bên trong để tự quyết định lỗi
  // "không bóc được" có ưu tiên hơn lỗi "trùng kiện" hay không.
  const macThu = macVanDonTu(raw);
  const dkTraTrung = macThu
    ? or(eq(schema.shipments.id, shipmentId), sql`upper(${schema.shipments.trackingNumber}) = ${macThu}`)
    : eq(schema.shipments.id, shipmentId);
  const hang = await db.select({
    id: schema.shipments.id, trackingNumber: schema.shipments.trackingNumber,
    carrierKey: schema.shipments.carrierKey,
  }).from(schema.shipments).where(dkTraTrung);

  // I8: kiện không tồn tại → CHẶN ở đây, không được tiếp tục rồi báo `ok: true`
  // cho một thao tác chưa ghi được gì (mẫu đúng: `verifyDiaChiKien` trả `ok: false`).
  const kienHienTai = hang.find((r) => r.id === shipmentId);
  if (!kienHienTai) return { ok: false, loi: 'Không tìm thấy kiện' };

  const macHienTai = kienHienTai.trackingNumber?.toUpperCase() ?? null;
  // I5: kiện đã có một mã KHÁC rồi — chặn, không âm thầm ghi đè (dán lại ĐÚNG mã
  // cũ vẫn qua, vì đó không phải ghi đè, chỉ là lặp tay).
  if (macThu && macHienTai && macHienTai !== macThu) {
    return {
      ok: false,
      loi: `Kiện này đã có mã vận đơn khác (${kienHienTai.trackingNumber}) — không được ghi đè âm thầm. Kiểm tra lại trước khi đổi mã.`,
    };
  }

  const dangDungOKienKhac = macThu != null
    && hang.some((r) => r.id !== shipmentId && r.trackingNumber?.toUpperCase() === macThu);

  const kt = kiemTraTracking(raw, dangDungOKienKhac);
  if (!kt.ok) return { ok: false, loi: kt.loi };
  return { ok: true, tracking: kt.tracking, carrierKey: kienHienTai.carrierKey };
}

export type KetQuaPhanTich =
  | ({ ok: true } & KetQuaPhanTichVanDon)
  | { ok: false; loi: string };

/**
 * BƯỚC 1 của luồng mới (CEO 14/10/2026): nhận mã vận đơn, nói trước sẽ ghi gì — **KHÔNG GHI
 * GÌ CẢ**.
 *
 * Không lưu `tracking_number`, không chạm Lark, không đóng dấu `gia_uoc_tinh_ghi_luc`. Nhân
 * sự huỷ ở bước này thì hệ thống phải y nguyên như trước lúc họ bấm — đó là cả lý do tồn tại
 * của bước này: Lark KHÔNG CÓ UNDO (luật chỉ-điền-ô-trống chỉ cho điền thêm, ghi sai là người
 * phải vào xoá tay từng ô), nên con mắt người là lá chắn cuối trước khi ghi.
 *
 * CÓ hai tác dụng phụ không tránh được, và cả hai đều KHÔNG phải "ghi" theo nghĩa trên:
 *   - gọi Rate API của hãng (FedEx/UPS) — tốn một lượt hạn mức;
 *   - với FedEx, `layGiaUocTinh` ghi dòng cache `fedex_rate_quotes` nếu kiện chưa có. Đó là
 *     cache nội bộ, và chính nhờ nó mà bước xác nhận dùng lại ĐÚNG con số nhân sự vừa xem
 *     (hàm đó đọc cache trước, chỉ quote khi chưa có).
 *
 * Truyền `tracking` vào `layGiaUocTinh`: xem bình luận tham số `trackingDuTinh` ở đó — không
 * truyền thì bảng xem trước và lượt ghi có thể suy ra hai hãng khác nhau.
 */
export async function phanTichTruocKhiGhi(shipmentId: string, raw: string): Promise<KetQuaPhanTich> {
  const ai = await nguoiDuocGhiVanDon();
  if (!ai.ok) return { ok: false, loi: ai.loi };

  const ma = await kiemMaChoKien(shipmentId, raw);
  if (!ma.ok) return { ok: false, loi: ma.loi };

  const canhBao: string[] = [];
  const lech = canhBaoLechHang(ma.tracking, ma.carrierKey);
  if (lech) canhBao.push(lech);

  /** Trả về cho giao diện khi KHÔNG dựng được bảng — vẫn `ok` vì mã vận đơn vẫn lưu được,
   *  chỉ là chưa ghi giá; `lyDoTrong` nói thẳng vì sao. */
  const trong = (lyDo: string): { ok: true } & KetQuaPhanTichVanDon => ({
    ok: true, tracking: ma.tracking, nguon: null, xem: null, lyDoTrong: lyDo, canhBao,
  });

  let gia: Awaited<ReturnType<typeof layGiaUocTinh>>;
  try {
    gia = await layGiaUocTinh(shipmentId, ma.tracking);
  } catch (e) {
    console.error('[dong-hang] phanTichTruocKhiGhi: lấy giá lỗi:', e);
    return trong('lấy giá ước tính hỏng giữa đường — vẫn lưu được mã vận đơn, cron sẽ thử ghi giá sau');
  }
  if (!gia) {
    return trong('chưa lấy được giá ước tính cho kiện này (thiếu cân/nước, hãng không trả lời, hoặc sai đơn vị tiền) — vẫn lưu được mã vận đơn, cron sẽ thử lại');
  }

  /* `maLa` là khoản tiền THẬT của hãng mà hình chung không có cột để đựng (vd mã UPS
   * '110'/'190'). Nó nằm trong ô Tổng nhưng không nằm ở ô thành phần nào — không nói ra thì
   * không ai biết vì sao tổng ≠ cộng các ô. Khử trùng: một mã nhiều dòng chỉ kể một lần. */
  const maLa = [...new Set(gia.maLa)];
  if (maLa.length > 0) {
    canhBao.push(`khoản hãng chưa có cột để đựng: ${maLa.join(', ')} — nằm trong ô Tổng nhưng không nằm ở ô thành phần nào, kiểm lại bằng mắt`);
  }

  /* Giá FedEx chỉ khớp con số hãng hiện trên cổng khi hỏi bằng ĐÚNG thông số của vận đơn (loại
   * bao gói, cân, kích thước, cờ nhà dân, ký nhận, ngày gửi — xem `theoVanDon` ở
   * gia-uoc-tinh.ts). Nhãn vừa tạo thì FedEx chưa có dữ liệu để tra, đường giá phải dựng lại
   * từ cột của mình, và chênh có thể tới cả trăm nghìn một kiện. Im lặng ở đây là đưa nhân sự
   * một con số trông y hệt số chuẩn mà họ không có cách nào biết là nó dựng lại. */
  /* Khoản vùng sâu xa có thể bị hãng bỏ qua vì tra theo tên thành phố khác — nêu ra TRƯỚC
   * khi nhân sự bấm ghi, vì sau khi ghi thì ô Lark không đè lại được. */
  if (gia.canhBaoVungXa) canhBao.push(gia.canhBaoVungXa);

  if (gia.nguon === 'fedex-api' && gia.theoVanDon === false) {
    canhBao.push('FedEx chưa có dữ liệu tra cứu cho mã này (nhãn vừa tạo) — giá đang DỰNG LẠI từ cân/kích thước trong hệ thống, có thể lệch với số hãng hiện trên cổng; chờ ít phút rồi phân tích lại sẽ khớp');
  }

  const [k] = await db.select({ larkRecordId: schema.shipments.larkRecordId })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!k?.larkRecordId) {
    return { ...trong('kiện chưa có dòng Lark tương ứng — không ghi giá được, nhưng mã vận đơn vẫn lưu vào SMS'), nguon: gia.nguon };
  }

  let rec: Awaited<ReturnType<typeof getLogRecordById>>;
  try {
    rec = await getLogRecordById(k.larkRecordId);
  } catch (e) {
    console.error('[dong-hang] phanTichTruocKhiGhi: đọc dòng Lark lỗi:', e);
    return { ...trong(`không đọc được dòng Lark (${e instanceof Error ? e.message : String(e)}) — chưa biết ô nào trống, cron sẽ thử lại sau`), nguon: gia.nguon };
  }
  if (!rec) {
    return { ...trong('dòng Lark của kiện không còn tồn tại (đã bị xoá bên Lark)'), nguon: gia.nguon };
  }

  const xem = xemTruocGhiGia(gia, rec.fields, ma.tracking);
  return {
    ok: true, tracking: ma.tracking, nguon: gia.nguon, xem, lyDoTrong: null,
    canhBao: [...canhBao, ...xem.canhBao],
  };
}

/**
 * BƯỚC 2 của luồng mới: nhân sự ĐÃ xem bảng `phanTichTruocKhiGhi` và BẤM XÁC NHẬN → lưu mã →
 * GHI GIÁ ƯỚC TÍNH lên dòng Lark của kiện đó (spec 2026-10-12, chẻ hai bước 14/10/2026).
 *
 * Hàm này KHÔNG tự đòi bằng chứng "đã xem trước": không có trạng thái nào giữa hai lượt gọi
 * để đòi, và dựng một dấu phiên chỉ để tự bịt mình thì vừa thêm một ca hỏng vừa không chặn
 * được ai gọi thẳng. Việc chặn nằm ở giao diện: không có nút nào ghi mà không qua bảng xem
 * trước (xem `components/dong-hang/HopThoaiXacNhanVanDon.tsx`). Luật kiểm mã thì dùng CHUNG
 * `kiemMaChoKien` với bước phân tích, nên thứ nhân sự xem và thứ được ghi không lệch nhau.
 *
 * Gác `tao_van_don` (xem `nguoiDuocGhiVanDon` để biết vì sao là quyền RIÊNG chứ không phải
 * `manage_fulfillment` như trước 21/10/2026, và vì sao KHÔNG phải `view_fulfillment` như bản
 * đầu): hàm này ghi ra Lark — hệ thống NGOÀI, không sửa lại được bằng máy khi sai (luật
 * chỉ-điền-ô-trống chỉ cho điền thêm, lỡ ghi sai phải người vào xoá tay từng ô) — nặng hơn
 * mức `view_fulfillment` mà vai trò `viewer` (chỉ-xem) cũng có. Nhưng nhẹ hơn đóng/mở kiện
 * (`nguoiDuocDongKien`) và ghi đóng thùng (`ghiDongThung`): hai việc đó sửa CHÍNH kiện hàng,
 * còn việc này chỉ gắn một mã vào kiện — nên từ 21/10/2026 chúng KHÔNG còn cùng một mốc.
 *
 * Thứ tự BẮT BUỘC, không đổi (Ruling người điều phối):
 *   1. `kiemTraTracking` (có tra DB xem mã đã thuộc kiện KHÁC chưa) — hỏng thì
 *      dừng ở đây, CHƯA ghi gì.
 *   2. Lưu `shipments.tracking_number` NGAY — mọi bước sau là best-effort.
 *   3-5. `ghiGiaUocTinhLenLark` (lấy giá → đọc record Lark → patch → ghi, chỉ
 *      ô trống) — dùng CHUNG với cron điền bù (Task 7), không viết lại logic ghi
 *      Lark lần thứ hai ở đây (D-045).
 *
 * Mọi nhánh từ bước 3 trở đi đều trả `ok: true` kèm `canhBao` khi có vấn đề —
 * mã vận đơn đã nằm trong CSDL rồi, không được coi thao tác là thất bại chỉ vì
 * chưa ghi được giá hoặc kiện chưa có dòng Lark (Review Focus #2: phải NÓI RA,
 * không im lặng coi như xong).
 */
export async function luuTrackingChoKien(shipmentId: string, raw: string): Promise<KetQuaLuuTracking> {
  // Gác `tao_van_don`, KHÔNG phải `view_fulfillment`: hàm này ghi ra một hệ
  // thống NGOÀI (dòng Lark vận hành thật) mà máy không tự sửa lại được — ghi
  // sai một ô thì phải người vào xoá tay (luật chỉ-điền-ô-trống không cho máy
  // đè lại). `view_fulfillment` còn nằm trong tay vai trò `viewer` (chỉ-được-
  // xem) — gác ở mức đó là để người chỉ-xem cũng kích hoạt được ghi DB + gọi
  // API tính cước hãng + ghi Lark.
  const ai = await nguoiDuocGhiVanDon();
  if (!ai.ok) return { ok: false, loi: ai.loi };

  const kt = await kiemMaChoKien(shipmentId, raw);
  if (!kt.ok) return { ok: false, loi: kt.loi };

  // Bước 2: LƯU NGAY. Từ đây mọi thứ là best-effort — hỏng ở dưới không được
  // xoá công của bước lưu này. Kiện đã xác nhận TỒN TẠI ở trên nên không cần
  // kiểm `returning()` ở đây nữa.
  //
  // `trackingNhapLuc` đóng trong CÙNG lệnh này, không phải một UPDATE riêng: đó là dấu
  // "mã này do NHÂN SỰ nhập qua hệ thống" và là điều kiện PHẠM VI của cron điền bù
  // (`DAU_NHAP_QUA_HE_THONG` trong dien-bu.ts — CEO 14/10/2026). Cùng một lệnh thì mã và
  // dấu của nó KHÔNG BAO GIỜ lệch nhau; đóng dấu riêng mà lệnh đó hỏng là kiện có mã
  // nhưng vô hình với cron, im lặng không ai biết. Đổi lại: cột `tracking_nhap_luc`
  // (migration 0205) PHẢI được áp tay TRƯỚC khi deploy — chưa có cột thì lệnh này đổ và
  // cả thao tác nhập mã vận đơn thất bại (hỏng ỒN ÀO, thấy ngay, thay vì âm thầm).
  //
  // Giao dịch của `ghiVoi` bọc ĐÚNG lệnh này, không bọc `ghiGiaUocTinhLenLark` bên dưới:
  // bước đó gọi API Lark hàng giây, giữ khoá `shipments` suốt lượt gọi mạng là chặn cả
  // màn Đóng hàng; và nó CỐ Ý best-effort — nằm trong giao dịch thì một lỗi Lark sẽ
  // cuốn ngược cả mã vận đơn vừa lưu, đúng cái thứ tự bắt buộc ở trên cấm.
  try {
    await ghiVoi({ kieu: 'nguoi', userId: ai.id }, (tx) => tx.update(schema.shipments)
      .set({ trackingNumber: kt.tracking, trackingNhapLuc: new Date(), updatedAt: new Date() })
      .where(eq(schema.shipments.id, shipmentId)));
  } catch (e) {
    console.error('[dong-hang] luuTrackingChoKien: lưu tracking lỗi:', e);
    return { ok: false, loi: 'Lưu mã vận đơn thất bại.' };
  }

  duongDongHang();

  // Bước 3-5: ghi giá ước tính lên Lark — đường ghi CHUNG với cron Task 7.
  const g = await ghiGiaUocTinhLenLark(shipmentId);
  /* I6: gộp cảnh báo lệch hãng vào cùng một câu với cảnh báo ghi giá — ô nhập chỉ hiện MỘT
   * toast, nói ra một việc rồi nuốt việc kia cũng là im lặng. */
  const canhBao = [canhBaoLechHang(kt.tracking, kt.carrierKey), g.canhBao]
    .filter((c): c is string => c != null && c !== '').join(' · ');
  return { ok: true, tracking: kt.tracking, giaDaGhi: g.giaDaGhi, canhBao: canhBao || undefined };
}
