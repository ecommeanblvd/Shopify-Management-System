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
import { slaCuaNuoc } from '@/features/shipments/sop-giao-hang';
import { xepLoaiSla, type KetQuaSla } from '@/features/kpi-logistics/chi-tiet';
import { layLoaiSuCo, tongChiPhi, thietHaiRong, type KhoanChiPhi } from './su-co';

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
  thuVnd: number;
  vonVnd: number;
  laiVnd: number;
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
    db.execute<{ id: string; code: string; brand: string; cc: string; gui: string | null; giao: string | null; can: string | null; thu: string | null; von_that: string | null; von_bao: string | null; st: string; dst: string | null }>(sql`
      SELECT o.id, o.code, o.partner_brand_slug AS brand, o.country AS cc,
             o.shipped_at::text AS gui, o.delivered_at::text AS giao, o.weight_kg::text AS can,
             o.charged_vnd::text AS thu, o.actual_carrier_cost_vnd::text AS von_that,
             o.carrier_cost_vnd::text AS von_bao, o.status::text AS st, o.delivery_status AS dst
        FROM ship_ho_orders o
       WHERE o.shipped_at IS NOT NULL AND o.shipped_at >= ${tu}::date AND o.shipped_at <= ${den}::date
       ORDER BY o.shipped_at, o.code;`),
    db.execute<{ id: string; order_id: string; ma: string; brand: string; loai: string; thuoc_ve: string; ngay: string; mo_ta: string | null; chi_phi: unknown; tong: string; thu_hoi: string }>(sql`
      SELECT s.id, s.order_id, o.code AS ma, o.partner_brand_slug AS brand, s.loai, s.thuoc_ve, s.ngay::text AS ngay,
             s.mo_ta, s.chi_phi, s.tong_chi_phi_vnd::text AS tong, s.da_thu_hoi_vnd::text AS thu_hoi
        FROM ship_ho_su_co s JOIN ship_ho_orders o ON o.id = s.order_id
       WHERE s.ngay >= ${tu}::date AND s.ngay <= ${den}::date
       ORDER BY s.ngay DESC, s.tong_chi_phi_vnd DESC;`),
  ]);

  const donHang: DongDonShipHo[] = donRows.rows.map((r) => {
    const thu = so(r.thu);
    const vonThat = r.von_that != null;
    const von = vonThat ? so(r.von_that) : so(r.von_bao);
    return {
      id: r.id, ma: r.code, brand: r.brand, nuoc: r.cc,
      ngayGui: r.gui ? r.gui.slice(0, 10) : null,
      canKg: r.can == null ? null : Number(r.can),
      thuVnd: Math.round(thu), vonVnd: Math.round(von), laiVnd: Math.round(thu - von),
      vonThat, trangThai: r.st,
    };
  });

  const sla: DongSlaShipHo[] = donRows.rows.map((r) => {
    const nuoc = (r.cc ?? '?').trim().toUpperCase();
    const slaNgay = slaCuaNuoc(nuoc);
    let soNgay: number | null = null;
    if (r.gui && r.giao) {
      const ms = new Date(r.giao).getTime() - new Date(`${r.gui.slice(0, 10)}T00:00:00Z`).getTime();
      // Kẹp về 0: `shipped_at` là NGÀY còn `delivered_at` là mốc thời gian, giao ngay
      // trong ngày gửi sẽ ra số âm vì lệch múi giờ — âm không có nghĩa là giao trước khi gửi.
      soNgay = Math.max(0, Math.round((ms / 86_400_000) * 10) / 10);
    }
    return {
      ma: r.code, brand: r.brand, nuoc,
      ngayGui: r.gui ? r.gui.slice(0, 10) : null,
      ngayGiao: r.giao ? r.giao.slice(0, 10) : null,
      soNgay, slaNgay,
      ketQua: soNgay == null ? null : xepLoaiSla(soNgay, slaNgay, false),
      trangThaiGiao: r.dst,
    };
  });

  const suCo: DongSuCo[] = suCoRows.rows.map((r) => {
    const tong = Math.round(so(r.tong));
    const thuHoi = Math.round(so(r.thu_hoi));
    return {
      id: r.id, orderId: r.order_id, maDon: r.ma, brand: r.brand,
      loai: r.loai, tenLoai: layLoaiSuCo(r.loai)?.ten ?? r.loai,
      thuocVe: r.thuoc_ve, ngay: r.ngay, moTa: r.mo_ta,
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
  chiPhi: KhoanChiPhi[];
  daThuHoiVnd: number;
}

/** Thêm hoặc sửa một sự cố. Tổng tiền LUÔN tính lại từ danh sách khoản, không nhận số gửi lên. */
export async function luuSuCo(input: LuuSuCoInput): Promise<{ ok: true; id: string }> {
  const userId = await requireSua();
  if (!layLoaiSuCo(input.loai)) throw new Error('Loại sự cố không hợp lệ');
  const khoan = input.chiPhi.filter((k) => k.khoan.trim() && Number.isFinite(k.tienVnd) && k.tienVnd > 0);
  const tong = tongChiPhi(khoan);
  const thuHoi = Math.max(0, Math.round(input.daThuHoiVnd));
  const gia = {
    orderId: input.orderId,
    loai: input.loai,
    thuocVe: input.thuocVe,
    ngay: input.ngay,
    moTa: input.moTa?.trim() || null,
    chiPhi: khoan,
    tongChiPhiVnd: String(tong),
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
