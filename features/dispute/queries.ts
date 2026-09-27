'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { gomTheoTienTe, type TongTheoTien } from './tong-tien';
import type { ChiTietDispute, DongDispute, LocDispute } from './types';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

function doiDong(x: Record<string, unknown>): DongDispute {
  return {
    id: String(x.id),
    store: String(x.store),
    storeId: String(x.store_id),
    nguon: String(x.nguon),
    shopifyDisputeId: (x.shopify_dispute_id as string) ?? null,
    maHoSo: (x.ma_ho_so as string) ?? null,
    congThanhToan: (x.cong_thanh_toan as string) ?? null,
    loai: String(x.loai),
    trangThai: String(x.trang_thai),
    lyDo: (x.ly_do as string) ?? null,
    lyDoMang: (x.ly_do_mang as string) ?? null,
    soTien: String(x.so_tien),
    tienTe: String(x.tien_te),
    phiDispute: x.phi_dispute == null ? null : String(x.phi_dispute),
    moLuc: x.mo_luc ? new Date(x.mo_luc as string) : null,
    hanNop: x.han_nop ? new Date(x.han_nop as string) : null,
    daNopLuc: x.da_nop_luc ? new Date(x.da_nop_luc as string) : null,
    chotLuc: x.chot_luc ? new Date(x.chot_luc as string) : null,
    maDon: (x.ma_don as string) ?? null,
    coDonTrongHeThong: x.order_id != null,
    khachEmail: (x.khach_email as string) ?? null,
    soGhiChu: Number(x.so_ghi_chu ?? 0),
  };
}

const CHON = sql`
  d.id, d.store_id, s.name AS store, d.nguon, d.shopify_dispute_id, d.ma_ho_so,
  d.loai, d.trang_thai, d.ly_do, d.ly_do_mang, d.so_tien, d.tien_te, d.phi_dispute,
  d.mo_luc, d.han_nop, d.da_nop_luc, d.chot_luc, d.ma_don, d.order_id, d.khach_email,
  (SELECT count(*)::int FROM dispute_ghi_chu g WHERE g.dispute_id = d.id) AS so_ghi_chu`;

const CONG = sql`d.cong_thanh_toan`;

export async function danhSachDispute(loc: LocDispute = {}): Promise<DongDispute[]> {
  await requirePerm('view_cx_dispute');
  const r = await db.execute(sql`
    SELECT ${CHON}, ${CONG}
    FROM dispute d JOIN stores s ON s.id = d.store_id
    WHERE (${loc.storeId ?? null}::uuid IS NULL OR d.store_id = ${loc.storeId ?? null}::uuid)
      AND (${loc.trangThai ?? null}::text IS NULL OR d.trang_thai = ${loc.trangThai ?? null})
      AND (${loc.nguon ?? null}::text IS NULL OR d.nguon = ${loc.nguon ?? null})
      AND (${loc.cong ?? null}::text IS NULL OR d.cong_thanh_toan = ${loc.cong ?? null})
      AND (${loc.dangMo ?? false} = false OR d.trang_thai IN ('needs_response', 'under_review'))
    ORDER BY d.mo_luc DESC NULLS LAST
    LIMIT 500`);
  return rows<Record<string, unknown>>(r).map(doiDong);
}

/**
 * Ca CÒN PHẢI LÀM, khối trên của màn.
 *
 * Thứ tự: CHƯA nộp bằng chứng trước, rồi hạn gần nhất trước, ca không hạn cuối.
 *
 * Hai lần sắp xếp này đều để trả lời đúng một câu: "việc nào đang chờ MÌNH".
 * Ca đã nộp bằng chứng là đang chờ ngân hàng, không chờ mình — xếp theo hạn
 * thuần thì một ca năm 2020 đã nộp xong đứng đầu danh sách việc hôm nay. Ca
 * không có hạn xếp cuối vì `NULL` sắp trước sẽ đẩy ca sắp mất tiền xuống dưới
 * màn hình.
 */
export async function disputeDangMo(): Promise<DongDispute[]> {
  await requirePerm('view_cx_dispute');
  const r = await db.execute(sql`
    SELECT ${CHON}, ${CONG}
    FROM dispute d JOIN stores s ON s.id = d.store_id
    WHERE d.trang_thai IN ('needs_response', 'under_review')
    ORDER BY (d.da_nop_luc IS NOT NULL), d.han_nop ASC NULLS LAST
    LIMIT 100`);
  return rows<Record<string, unknown>>(r).map(doiDong);
}

/** Tổng tiền TÁCH THEO ĐƠN VỊ TIỀN — không bao giờ cộng gộp (xem tong-tien.ts). */
export async function tongTienTheoTrangThai(): Promise<
  { trangThai: string; soCa: number; tong: TongTheoTien[] }[]
> {
  await requirePerm('view_cx_dispute');
  const r = await db.execute(sql`
    SELECT trang_thai, so_tien, tien_te FROM dispute`);
  const theo = new Map<string, { soTien: string; tienTe: string }[]>();
  for (const x of rows<Record<string, unknown>>(r)) {
    const k = String(x.trang_thai);
    const ds = theo.get(k) ?? [];
    ds.push({ soTien: String(x.so_tien), tienTe: String(x.tien_te) });
    theo.set(k, ds);
  }
  return [...theo].map(([trangThai, ds]) => ({
    trangThai, soCa: ds.length, tong: gomTheoTienTe(ds),
  })).sort((a, b) => b.soCa - a.soCa);
}

export async function chiTietDispute(id: string): Promise<ChiTietDispute | null> {
  await requirePerm('view_cx_dispute');
  const d = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT ${CHON}, ${CONG}, d.dong_bo_luc
    FROM dispute d JOIN stores s ON s.id = d.store_id
    WHERE d.id = ${id}::uuid`))[0];
  if (!d) return null;
  const gc = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT g.id, g.noi_dung, g.tu_lark, g.created_at, u.name AS ten
    FROM dispute_ghi_chu g LEFT JOIN "user" u ON u.id = g.tao_boi
    WHERE g.dispute_id = ${id}::uuid ORDER BY g.created_at`));
  return {
    ...doiDong(d),
    dongBoLuc: d.dong_bo_luc ? new Date(d.dong_bo_luc as string) : null,
    ghiChu: gc.map((g) => ({
      id: String(g.id),
      noiDung: String(g.noi_dung),
      tenNguoiGhi: (g.ten as string) ?? null,
      tuLark: Boolean(g.tu_lark),
      taoLuc: new Date(g.created_at as string),
    })),
  };
}
