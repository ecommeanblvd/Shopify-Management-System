import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { soNgayTre } from './chi-phi';
import type { DongDon, TrangThaiDon, HinhThuc, MucDich } from './types';

/** Một dòng trong bảng danh sách đơn — kèm số dòng hàng, không cần tải cả dòng. */
export interface DonTomTat {
  id: string;
  ma: string;
  trangThai: TrangThaiDon;
  mucDich: MucDich;
  nguoiNhanId: string;
  /** Ảnh chụp tên người nhận tại lúc tạo đơn, không phải tra sổ KOL hiện tại. */
  tenNhan: string;
  /** 'VN' là nội địa, khác là quốc tế — suy ra ở tầng hiển thị. */
  quocGia: string;
  hangVanChuyen: string | null;
  maVanDon: string | null;
  taoLuc: Date;
  guiLuc: Date | null;
  soDong: number;
}

/** Đơn đầy đủ — đúng các cột của `kol_don`. */
export interface DonDayDu {
  id: string;
  ma: string;
  nguoiNhanId: string;
  mucDich: MucDich;
  trangThai: TrangThaiDon;
  tenNhan: string;
  dienThoaiNhan: string | null;
  quocGia: string;
  thanhPho: string | null;
  diaChi: string | null;
  hangVanChuyen: string | null;
  maVanDon: string | null;
  guiLuc: Date | null;
  daNhanLuc: Date | null;
  ghiChu: string | null;
  taoLuc: Date;
  taoBoi: string | null;
  suaLuc: Date;
  suaBoi: string | null;
}

/** Một hồ sơ trong sổ KOL. */
export interface NguoiNhan {
  id: string;
  ten: string;
  kenh: string | null;
  dienThoai: string | null;
  email: string | null;
  quocGia: string;
  diaChi: string | null;
  thanhPho: string | null;
  ghiChu: string | null;
  ngungDung: boolean;
}

/** Một dòng hàng mượn còn chưa trả đủ — dùng cho màn "Đang mượn". */
export interface MonDangMuon {
  dongDonId: string;
  donId: string;
  ma: string;
  sku: string;
  tenHang: string | null;
  kho: string;
  soLuong: number;
  soLuongDaTra: number;
  /** so_luong - so_luong_da_tra, luôn > 0 vì đã lọc ở WHERE. */
  conNo: number;
  hanTra: string | null;
  /** null khi không có hạn trả (không xảy ra ở đây vì đã lọc hinh_thuc = 'muon'). */
  soNgayTre: number | null;
  /** Ảnh chụp tên người nhận trên đơn — người đang giữ hàng. */
  tenNhan: string;
}

const CAC_CET_DONG_DON = {
  id: schema.kolDongDon.id,
  sku: schema.kolDongDon.sku,
  tenHang: schema.kolDongDon.tenHang,
  kho: schema.kolDongDon.kho,
  soLuong: schema.kolDongDon.soLuong,
  hinhThuc: schema.kolDongDon.hinhThuc,
  hanTra: schema.kolDongDon.hanTra,
  giaVon: schema.kolDongDon.giaVon,
  giaVonTienTe: schema.kolDongDon.giaVonTienTe,
  soLuongDaTra: schema.kolDongDon.soLuongDaTra,
  soLuongNhapLai: schema.kolDongDon.soLuongNhapLai,
} as const;

/** Danh sách đơn, mới nhất trước, tối đa 500 dòng. Lọc tuỳ chọn theo trạng thái / người nhận. */
export async function danhSachDon(
  loc: { trangThai?: string; nguoiNhanId?: string } = {},
): Promise<DonTomTat[]> {
  const dk = [];
  if (loc.trangThai) dk.push(eq(schema.kolDon.trangThai, loc.trangThai as TrangThaiDon));
  if (loc.nguoiNhanId) dk.push(eq(schema.kolDon.nguoiNhanId, loc.nguoiNhanId));

  const rows = await db
    .select({
      id: schema.kolDon.id,
      ma: schema.kolDon.ma,
      trangThai: schema.kolDon.trangThai,
      mucDich: schema.kolDon.mucDich,
      nguoiNhanId: schema.kolDon.nguoiNhanId,
      tenNhan: schema.kolDon.tenNhan,
      quocGia: schema.kolDon.quocGia,
      hangVanChuyen: schema.kolDon.hangVanChuyen,
      maVanDon: schema.kolDon.maVanDon,
      taoLuc: schema.kolDon.taoLuc,
      guiLuc: schema.kolDon.guiLuc,
      soDong: sql<number>`count(${schema.kolDongDon.id})::int`,
    })
    .from(schema.kolDon)
    .leftJoin(schema.kolDongDon, eq(schema.kolDongDon.donId, schema.kolDon.id))
    .where(dk.length ? and(...dk) : undefined)
    .groupBy(schema.kolDon.id)
    .orderBy(desc(schema.kolDon.taoLuc))
    .limit(500);

  return rows;
}

/** Chi tiết một đơn theo mã. Trả `null` gọn gàng khi không có, không ném lỗi. */
export async function chiTietDon(ma: string): Promise<{ don: DonDayDu; dong: DongDon[] } | null> {
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.ma, ma)).limit(1);
  if (!don) return null;

  const dong = await db
    .select(CAC_CET_DONG_DON)
    .from(schema.kolDongDon)
    .where(eq(schema.kolDongDon.donId, don.id));

  return { don, dong };
}

/** Sổ KOL. Mặc định ẩn hồ sơ đã ngừng dùng khỏi ô chọn. */
export async function danhSachNguoiNhan(gomCaNgung = false): Promise<NguoiNhan[]> {
  return db
    .select({
      id: schema.kolNguoiNhan.id,
      ten: schema.kolNguoiNhan.ten,
      kenh: schema.kolNguoiNhan.kenh,
      dienThoai: schema.kolNguoiNhan.dienThoai,
      email: schema.kolNguoiNhan.email,
      quocGia: schema.kolNguoiNhan.quocGia,
      diaChi: schema.kolNguoiNhan.diaChi,
      thanhPho: schema.kolNguoiNhan.thanhPho,
      ghiChu: schema.kolNguoiNhan.ghiChu,
      ngungDung: schema.kolNguoiNhan.ngungDung,
    })
    .from(schema.kolNguoiNhan)
    .where(gomCaNgung ? undefined : eq(schema.kolNguoiNhan.ngungDung, false))
    .orderBy(schema.kolNguoiNhan.ten);
}

/**
 * Mọi dòng hàng mượn còn chưa trả đủ, quá hạn xếp trên cùng (`han_tra` tăng
 * dần, `NULLS LAST`). `homNay` là ngày hiện tại theo GIỜ KINH DOANH — gọi nơi
 * dùng `ngayKinhDoanh(new Date())`, hàm này không tự suy ra để giữ thuần khiết
 * cho phần tính (soNgayTre).
 */
export async function dangMuon(homNay: string): Promise<MonDangMuon[]> {
  const rows = await db
    .select({
      dongDonId: schema.kolDongDon.id,
      donId: schema.kolDon.id,
      ma: schema.kolDon.ma,
      sku: schema.kolDongDon.sku,
      tenHang: schema.kolDongDon.tenHang,
      kho: schema.kolDongDon.kho,
      soLuong: schema.kolDongDon.soLuong,
      soLuongDaTra: schema.kolDongDon.soLuongDaTra,
      hanTra: schema.kolDongDon.hanTra,
      tenNhan: schema.kolDon.tenNhan,
    })
    .from(schema.kolDongDon)
    .innerJoin(schema.kolDon, eq(schema.kolDon.id, schema.kolDongDon.donId))
    .where(and(
      eq(schema.kolDongDon.hinhThuc, 'muon' as HinhThuc),
      sql`${schema.kolDongDon.soLuongDaTra} < ${schema.kolDongDon.soLuong}`,
    ))
    .orderBy(sql`${schema.kolDongDon.hanTra} ASC NULLS LAST`);

  return rows.map((r) => ({
    ...r,
    conNo: r.soLuong - r.soLuongDaTra,
    soNgayTre: soNgayTre(r.hanTra, homNay),
  }));
}

/** Tồn khả dụng = qty_on_hand - qty_reserved. 0 khi chưa có dòng tồn cho SKU×kho đó. */
export async function tonKhaDung(sku: string, kho: string): Promise<number> {
  const [row] = await db
    .select({ qtyOnHand: schema.warehouseInventory.qtyOnHand, qtyReserved: schema.warehouseInventory.qtyReserved })
    .from(schema.warehouseInventory)
    .where(and(eq(schema.warehouseInventory.sku, sku), eq(schema.warehouseInventory.warehouseCode, kho)))
    .limit(1);
  if (!row) return 0;
  return row.qtyOnHand - row.qtyReserved;
}
