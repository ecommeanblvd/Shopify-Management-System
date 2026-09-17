'use server';

/**
 * Report chi tiết Pillar 2 (ship hộ) cho bảng KPI Logistics: không chỉ đếm đơn mà còn
 * soi được tiền bị bill so với tiền thu, tiến độ giao so với cam kết, và các sự cố
 * phải đền (CEO 11/09/2026).
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { slaCuaNuoc, NGUONG_NGOAI_LE_SOP } from '@/features/shipments/sop-giao-hang';
import { lyDoCoHieuLuc } from '@/features/shipments/ly-do-cham';
import { xepLoaiSla, type KetQuaSla } from '@/features/kpi-logistics/chi-tiet';
import { layLoaiSuCo, tongChiPhi, thietHaiRong, DIEN_BIEN, type KhoanChiPhi } from './su-co';

async function requireXem(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) {
    throw new Error('Không có quyền xem bảng KPI logistics');
  }
}

/** Ghi sự cố: nhân sự quản lý ship hộ (hoặc admin). */
async function requireSua(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'manage_ship_ho'))) {
    throw new Error('Không có quyền ghi sự cố ship hộ');
  }
  return session.user.id;
}

export interface DongDonShipHo {
  id: string;
  ma: string;
  brand: string;
  nuoc: string;
  ngayGui: string | null;
  canKg: number | null;
  /** Giá thu brand: ưu tiên số tính LẠI trên cân thực, chưa báo giá thì null. */
  thuVnd: number | null;
  vonVnd: number;
  /** null khi chưa có giá thu — không được coi là lỗ. */
  laiVnd: number | null;
  /** Vốn lấy từ hoá đơn carrier thật hay mới là báo giá. */
  vonThat: boolean;
  trangThai: string;
}

export interface DongSlaShipHo {
  ma: string;
  brand: string;
  nuoc: string;
  ngayGui: string | null;
  ngayGiao: string | null;
  soNgay: number | null;
  slaNgay: number;
  /** null = chưa giao xong nên chưa chấm được. */
  ketQua: KetQuaSla | null;
  trangThaiGiao: string | null;
}

export interface DongSuCo {
  id: string;
  orderId: string;
  maDon: string;
  brand: string;
  loai: string;
  tenLoai: string;
  thuocVe: string;
  ngay: string;
  /** Ngày GHI vào hệ thống — quá hạn 7 ngày so với `ngay` là điều kiện trượt Gate Pillar 3. */
  ngayGhi: string;
  /** Mã diễn biến đã tick. */
  dienBien: string[];
  /** false = khai báo trước, tiền chốt sau. */
  daChotTien: boolean;
  /** true = tiền hàng đã có số thật từ đối soát, không ước bằng hệ số. */
  coTienHang: boolean;
  moTa: string | null;
  chiPhi: KhoanChiPhi[];
  tongChiPhiVnd: number;
  daThuHoiVnd: number;
  thietHaiRongVnd: number;
}

export interface ChiTietPillar2 {
  tu: string;
  den: string;
  donHang: DongDonShipHo[];
  sla: DongSlaShipHo[];
  suCo: DongSuCo[];
}

const so = (v: string | null | undefined): number => (v == null ? 0 : Number(v));

export async function docChiTietPillar2(tu: string, den: string): Promise<ChiTietPillar2> {
  await requireXem();
  const [donRows, suCoRows] = await Promise.all([
    db.execute<{ id: string; code: string; brand: string; cc: string; gui: string | null; giao: string | null; can: string | null; thu: string | null; von_that: string | null; von_bao: string | null; st: string; dst: string | null; ly_do: string | null; doi_chieu: string | null }>(sql`
      SELECT o.id, o.code, o.partner_brand_slug AS brand, o.country AS cc, o.ly_do_cham AS ly_do, o.ly_do_doi_chieu AS doi_chieu,
             o.shipped_at::text AS gui, o.delivered_at::text AS giao, o.weight_kg::text AS can,
             COALESCE(o.actual_charged_vnd, o.charged_vnd)::text AS thu, o.actual_carrier_cost_vnd::text AS von_that,
             o.carrier_cost_vnd::text AS von_bao, o.status::text AS st, o.delivery_status AS dst
        FROM ship_ho_orders o
       WHERE o.shipped_at IS NOT NULL AND o.shipped_at >= ${tu}::date AND o.shipped_at <= ${den}::date
       ORDER BY o.shipped_at, o.code;`),
    db.execute<{ id: string; order_id: string; ma: string; brand: string; loai: string; thuoc_ve: string; ngay: string; ghi: string; dien_bien: unknown; da_chot_tien: boolean; co_tien_hang: boolean; mo_ta: string | null; chi_phi: unknown; tong: string; thu_hoi: string }>(sql`
      SELECT s.id, s.order_id, o.code AS ma, o.partner_brand_slug AS brand, s.loai, s.thuoc_ve, s.ngay::text AS ngay,
             s.created_at::text AS ghi, s.dien_bien, s.da_chot_tien, s.co_tien_hang,
             s.mo_ta, s.chi_phi, s.tong_chi_phi_vnd::text AS tong, s.da_thu_hoi_vnd::text AS thu_hoi
        FROM ship_ho_su_co s JOIN ship_ho_orders o ON o.id = s.order_id
       WHERE s.ngay >= ${tu}::date AND s.ngay <= ${den}::date
       ORDER BY s.ngay DESC, s.tong_chi_phi_vnd DESC;`),
  ]);

  const donHang: DongDonShipHo[] = donRows.rows.map((r) => {
    // Chưa báo giá cho brand → để TRỐNG, không quy về 0 rồi tính thành lỗ.
    const thu = r.thu == null ? null : Math.round(so(r.thu));
    const vonThat = r.von_that != null;
    const von = Math.round(vonThat ? so(r.von_that) : so(r.von_bao));
    return {
      id: r.id, ma: r.code, brand: r.brand, nuoc: r.cc,
      ngayGui: r.gui ? r.gui.slice(0, 10) : null,
      canKg: r.can == null ? null : Number(r.can),
      thuVnd: thu, vonVnd: von, laiVnd: thu == null ? null : thu - von,
      vonThat, trangThai: r.st,
    };
  });

  // Kiện CHƯA GIAO cũng phải chấm (CEO 13/09/2026): đo số ngày đã trôi qua tới giờ. Quá cam kết
  // rồi thì trễ chắc chắn; còn trong hạn thì 'chua_den_han', đứng ngoài mẫu số. Trước đây kiện
  // chưa giao để `ketQua = null` và biến mất khỏi tỉ lệ, nên tỉ lệ đúng hạn luôn đẹp hơn thực tế.
  const bayGio = Date.now();
  const sla: DongSlaShipHo[] = donRows.rows.map((r) => {
    const nuoc = (r.cc ?? '?').trim().toUpperCase();
    const slaNgay = slaCuaNuoc(nuoc);
    const chuaGiao = r.giao == null;
    let soNgay: number | null = null;
    if (r.gui) {
      const den = r.giao ? new Date(r.giao).getTime() : bayGio;
      const ms = den - new Date(`${r.gui.slice(0, 10)}T00:00:00Z`).getTime();
      // Kẹp về 0: `shipped_at` là NGÀY còn `delivered_at` là mốc thời gian, giao ngay
      // trong ngày gửi sẽ ra số âm vì lệch múi giờ — âm không có nghĩa là giao trước khi gửi.
      soNgay = Math.max(0, Math.round((ms / 86_400_000) * 10) / 10);
    }
    // Kiện đang hoàn về không bao giờ tới tay khách → trễ chắc chắn, không chờ hết hạn.
    const dangHoan = r.dst === 'returning';
    // Cùng luật với tiêu chí 1.2: lý do ngoài tầm kiểm soát đã được hãng xác nhận thì rời mẫu số —
    // gồm cả đơn test / huỷ (CEO 17/09/2026).
    const loaiTru = soNgay != null && lyDoCoHieuLuc(r.ly_do, r.doi_chieu) && (r.ly_do === 'khong_gui_hang' || soNgay > slaNgay);
    return {
      ma: r.code, brand: r.brand, nuoc,
      ngayGui: r.gui ? r.gui.slice(0, 10) : null,
      ngayGiao: r.giao ? r.giao.slice(0, 10) : null,
      soNgay, slaNgay,
      ketQua: soNgay == null ? null
        : loaiTru ? 'loai_tru'
        : dangHoan ? (soNgay <= NGUONG_NGOAI_LE_SOP ? 'tre' : 'ngoai_le')
        : xepLoaiSla(soNgay, slaNgay, false, NGUONG_NGOAI_LE_SOP, chuaGiao),
      trangThaiGiao: r.dst,
    };
  });

  const suCo: DongSuCo[] = suCoRows.rows.map((r) => {
    const tong = Math.round(so(r.tong));
    const thuHoi = Math.round(so(r.thu_hoi));
    return {
      id: r.id, orderId: r.order_id, maDon: r.ma, brand: r.brand,
      loai: r.loai, tenLoai: layLoaiSuCo(r.loai)?.ten ?? r.loai,
      thuocVe: r.thuoc_ve, ngay: r.ngay, ngayGhi: r.ghi, moTa: r.mo_ta,
      dienBien: Array.isArray(r.dien_bien) ? (r.dien_bien as string[]) : [],
      daChotTien: r.da_chot_tien,
      coTienHang: r.co_tien_hang,
      chiPhi: Array.isArray(r.chi_phi) ? (r.chi_phi as KhoanChiPhi[]) : [],
      tongChiPhiVnd: tong, daThuHoiVnd: thuHoi, thietHaiRongVnd: thietHaiRong(tong, thuHoi),
    };
  });

  return { tu, den, donHang, sla, suCo };
}

export interface LuuSuCoInput {
  id?: string | null;
  orderId: string;
  loai: string;
  thuocVe: string;
  ngay: string;
  moTa: string | null;
  /** Mã diễn biến đã tick — thay cho việc gõ mô tả. */
  dienBien?: string[];
  chiPhi: KhoanChiPhi[];
  daThuHoiVnd: number;
  /** true = đã chốt tiền. Bỏ trống thì suy từ việc có khoản tiền nào hay chưa. */
  daChotTien?: boolean;
  /** true = tiền hàng đã có số thật từ đối soát → tắt hệ số hàng hoá. */
  coTienHang?: boolean;
}

/**
 * Thêm hoặc sửa một sự cố. Tổng tiền LUÔN tính lại từ danh sách khoản, không nhận số gửi lên.
 *
 * CHO PHÉP LƯU KHI CHƯA CÓ TIỀN (CEO 12/09/2026): hạn ghi sự cố là 7 ngày nhưng thiệt hại thật
 * thường chỉ biết sau khi hàng hoàn về và hoá đơn carrier tới. Bắt phải có tiền mới lưu được thì
 * Đức buộc phải ghi muộn, tức chính quy định làm trượt Gate.
 */
export async function luuSuCo(input: LuuSuCoInput): Promise<{ ok: true; id: string }> {
  const userId = await requireSua();
  if (!layLoaiSuCo(input.loai)) throw new Error('Loại sự cố không hợp lệ');
  const khoan = input.chiPhi.filter((k) => k.khoan.trim() && Number.isFinite(k.tienVnd) && k.tienVnd > 0);
  const tong = tongChiPhi(khoan);
  const thuHoi = Math.max(0, Math.round(input.daThuHoiVnd));
  const maDienBien = (input.dienBien ?? []).filter((m) => DIEN_BIEN.some((d) => d.ma === m));
  const gia = {
    orderId: input.orderId,
    loai: input.loai,
    thuocVe: input.thuocVe,
    ngay: input.ngay,
    moTa: input.moTa?.trim() || null,
    dienBien: maDienBien,
    chiPhi: khoan,
    tongChiPhiVnd: String(tong),
    daChotTien: input.daChotTien ?? tong > 0,
    coTienHang: input.coTienHang ?? false,
    daThuHoiVnd: String(thuHoi),
    updatedAt: new Date(),
  };
  let id = input.id ?? null;
  if (id) {
    await db.update(schema.shipHoSuCo).set(gia).where(eq(schema.shipHoSuCo.id, id));
  } else {
    const [row] = await db.insert(schema.shipHoSuCo).values({ ...gia, createdBy: userId }).returning({ id: schema.shipHoSuCo.id });
    id = row.id;
  }
  revalidatePath('/f/ship-report');
  return { ok: true, id };
}

export async function xoaSuCo(id: string): Promise<{ ok: true }> {
  await requireSua();
  await db.delete(schema.shipHoSuCo).where(eq(schema.shipHoSuCo.id, id));
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/** Danh sách đơn ship hộ trong kỳ để chọn khi ghi sự cố. */
export async function dsDonShipHo(tu: string, den: string): Promise<Array<{ id: string; ma: string; brand: string; nuoc: string }>> {
  await requireXem();
  const rows = await db.select({
    id: schema.shipHoOrders.id, ma: schema.shipHoOrders.code,
    brand: schema.shipHoOrders.partnerBrandSlug, nuoc: schema.shipHoOrders.country,
  }).from(schema.shipHoOrders)
    .where(and(gte(schema.shipHoOrders.shippedAt, tu), lte(schema.shipHoOrders.shippedAt, den)))
    .orderBy(schema.shipHoOrders.code);
  return rows;
}

export interface DonTimDuoc { id: string; ma: string; maBrand: string | null; brand: string; nuoc: string; tracking: string | null; ngayGui: string | null }

/**
 * Tìm đơn ship hộ để ghi sự cố — theo MÃ BRAND (#KLS2053), mã đơn nội bộ, hoặc mã vận đơn.
 *
 * Tìm trên TOÀN BỘ đơn chứ không chỉ đơn trong kỳ đang xem: sự cố hôm nay thường thuộc đơn gửi
 * từ tháng trước (ca KLS2053 gửi 24/08, phát hiện sang tháng 9), mà danh sách theo kỳ thì không
 * có đơn đó nên không ai ghi được.
 */
export async function timDonShipHo(tuKhoa: string): Promise<DonTimDuoc[]> {
  await requireXem();
  const q = tuKhoa.trim().replace(/^#/, '');
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const { rows } = await db.execute<{ id: string; ma: string; ma_brand: string | null; brand: string; nuoc: string; tk: string | null; gui: string | null }>(sql`
    SELECT id, code AS ma, brand_reference AS ma_brand, partner_brand_slug AS brand,
           COALESCE(country, '?') AS nuoc, tracking_number AS tk, shipped_at::text AS gui
      FROM ship_ho_orders
     WHERE brand_reference ILIKE ${like} OR code ILIKE ${like} OR tracking_number ILIKE ${like}
            OR lark_order_number ILIKE ${like}
     ORDER BY shipped_at DESC NULLS LAST
     LIMIT 20;`);
  return rows.map((r) => ({
    id: r.id, ma: r.ma, maBrand: r.ma_brand, brand: r.brand, nuoc: r.nuoc,
    tracking: r.tk, ngayGui: r.gui ? r.gui.slice(0, 10) : null,
  }));
}
