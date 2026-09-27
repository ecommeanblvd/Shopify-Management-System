'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { nguoiHienTai } from './nguoi';
import type { ChiTietTicket, DongDonGan, DongTicket, LocTicket } from './types';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/**
 * Danh sách ticket, mới nhất trước.
 *
 * Phần việc của từng bộ phận gom sẵn bằng `json_agg` — danh sách 200 ticket mà
 * gọi thêm một truy vấn cho mỗi dòng là 200 lượt đi lại vô ích.
 */
export async function danhSachTicket(loc: LocTicket = {}): Promise<DongTicket[]> {
  const nguoi = await nguoiHienTai();
  const boPhanToi = loc.cuaToi ? nguoi.boPhan : null;
  // `cuaToi` mà vai trò chưa gắn bộ phận thì không có gì là "của tôi" — trả rỗng
  // thay vì âm thầm hiện toàn bộ ticket của công ty.
  if (loc.cuaToi && boPhanToi == null) return [];

  const r = await db.execute(sql`
    SELECT t.id, t.ma_ticket, t.tieu_de, t.nhom, t.loai, t.bo_phan_neu, t.trang_thai,
           t.han_xu_ly, t.khach_email, t.nguon, t.created_at, t.dong_luc,
           s.name AS store,
           COALESCE((SELECT json_agg(json_build_object('boPhan', p.bo_phan, 'trangThai', p.trang_thai)
                                     ORDER BY p.bo_phan)
                     FROM cx_ticket_phan_viec p WHERE p.ticket_id = t.id), '[]'::json) AS phan_viec,
           (SELECT count(*)::int FROM cx_ticket_dong d WHERE d.ticket_id = t.id) AS so_dong
    FROM cx_ticket t
    LEFT JOIN stores s ON s.id = t.store_id
    WHERE (${loc.trangThai ?? null}::text IS NULL OR t.trang_thai = ${loc.trangThai ?? null})
      AND (${loc.nhom ?? null}::text IS NULL OR t.nhom = ${loc.nhom ?? null})
      AND (${loc.boPhan ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM cx_ticket_phan_viec p
            WHERE p.ticket_id = t.id AND p.bo_phan = ${loc.boPhan ?? null}))
      AND (${boPhanToi}::text IS NULL OR EXISTS (
            SELECT 1 FROM cx_ticket_phan_viec p
            WHERE p.ticket_id = t.id AND p.bo_phan = ${boPhanToi}))
    ORDER BY t.created_at DESC
    LIMIT 300`);

  return rows<Record<string, unknown>>(r).map((x) => ({
    id: String(x.id),
    maTicket: String(x.ma_ticket),
    tieuDe: String(x.tieu_de),
    nhom: String(x.nhom),
    loai: String(x.loai),
    boPhanNeu: String(x.bo_phan_neu),
    trangThai: String(x.trang_thai),
    hanXuLy: (x.han_xu_ly as string) ?? null,
    khachEmail: (x.khach_email as string) ?? null,
    store: (x.store as string) ?? null,
    nguon: String(x.nguon),
    taoLuc: new Date(x.created_at as string),
    dongLuc: x.dong_luc ? new Date(x.dong_luc as string) : null,
    phanViec: (x.phan_viec as { boPhan: string; trangThai: string }[]) ?? [],
    soDong: Number(x.so_dong),
  }));
}

/** Đếm ticket theo trạng thái — cho các chip lọc ở đầu màn. */
export async function demTheoTrangThai(): Promise<Record<string, number>> {
  await nguoiHienTai();
  const r = await db.execute(sql`
    SELECT trang_thai, count(*)::int AS n FROM cx_ticket GROUP BY trang_thai`);
  const out: Record<string, number> = {};
  for (const x of rows<{ trang_thai: string; n: number }>(r)) out[x.trang_thai] = Number(x.n);
  return out;
}

export async function chiTietTicket(id: string): Promise<ChiTietTicket | null> {
  await nguoiHienTai();
  const t = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT t.*, s.name AS store, u.name AS ten_nguoi_tao
    FROM cx_ticket t
    LEFT JOIN stores s ON s.id = t.store_id
    LEFT JOIN "user" u ON u.id = t.tao_boi
    WHERE t.id = ${id}::uuid`))[0];
  if (!t) return null;

  const pv = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT p.id, p.bo_phan, p.trang_thai, p.nguoi_phu_trach, p.xong_luc, u.name AS ten
    FROM cx_ticket_phan_viec p
    LEFT JOIN "user" u ON u.id = p.nguoi_phu_trach
    WHERE p.ticket_id = ${id}::uuid ORDER BY p.bo_phan`));

  const gc = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT g.id, g.bo_phan, g.noi_dung, g.ghi_ho, g.created_at, u.name AS ten
    FROM cx_ticket_ghi_chu g
    LEFT JOIN "user" u ON u.id = g.tao_boi
    WHERE g.ticket_id = ${id}::uuid ORDER BY g.created_at`));

  const dg = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT l.id AS line_id, o.shopify_order_number AS ma_don, s.name AS store,
           l.sku, l.product_title, l.variant_title, l.quantity, o.customer_email
    FROM cx_ticket_dong d
    JOIN shopify_order_lines l ON l.id = d.order_line_id
    JOIN shopify_orders o ON o.id = l.order_id
    JOIN stores s ON s.id = o.store_id
    WHERE d.ticket_id = ${id}::uuid ORDER BY o.shopify_order_number, l.sku`));

  return {
    id: String(t.id),
    maTicket: String(t.ma_ticket),
    tieuDe: String(t.tieu_de),
    nhom: String(t.nhom),
    loai: String(t.loai),
    boPhanNeu: String(t.bo_phan_neu),
    trangThai: String(t.trang_thai),
    hanXuLy: (t.han_xu_ly as string) ?? null,
    khachEmail: (t.khach_email as string) ?? null,
    store: (t.store as string) ?? null,
    nguon: String(t.nguon),
    taoLuc: new Date(t.created_at as string),
    dongLuc: t.dong_luc ? new Date(t.dong_luc as string) : null,
    maTicketCs: (t.ma_ticket_cs as string) ?? null,
    tenNguoiTao: (t.ten_nguoi_tao as string) ?? null,
    phanViec: pv.map((p) => ({ boPhan: String(p.bo_phan), trangThai: String(p.trang_thai) })),
    soDong: dg.length,
    phanViecDayDu: pv.map((p) => ({
      id: String(p.id),
      boPhan: String(p.bo_phan),
      trangThai: String(p.trang_thai),
      nguoiPhuTrach: (p.nguoi_phu_trach as string) ?? null,
      tenNguoiPhuTrach: (p.ten as string) ?? null,
      xongLuc: p.xong_luc ? new Date(p.xong_luc as string) : null,
    })),
    ghiChu: gc.map((g) => ({
      id: String(g.id),
      boPhan: String(g.bo_phan),
      noiDung: String(g.noi_dung),
      tenNguoiGhi: (g.ten as string) ?? null,
      ghiHo: Boolean(g.ghi_ho),
      taoLuc: new Date(g.created_at as string),
    })),
    dong: dg.map((x) => ({
      lineId: String(x.line_id),
      maDon: String(x.ma_don),
      store: (x.store as string) ?? null,
      sku: (x.sku as string) ?? null,
      tenSanPham: (x.product_title as string) ?? null,
      bienThe: (x.variant_title as string) ?? null,
      soLuong: Number(x.quantity),
      khachEmail: (x.customer_email as string) ?? null,
    })),
  };
}

/**
 * Tìm dòng đơn để gắn vào ticket. Khác `timDongDeTra` của module đổi trả: ở đây
 * KHÔNG lọc theo số món đã trả, vì một dòng có thể có nhiều ticket (và đã trả
 * hàng rồi vẫn phát sinh ticket).
 */
export async function timDongDon(tuKhoa: string): Promise<DongDonGan[]> {
  await nguoiHienTai();
  const q = tuKhoa.trim();
  if (q.length < 2) return [];
  const nhu = `%${q}%`;
  const r = await db.execute(sql`
    SELECT l.id AS line_id, o.shopify_order_number AS ma_don, s.name AS store,
           l.sku, l.product_title, l.variant_title, l.quantity, o.customer_email
    FROM shopify_order_lines l
    JOIN shopify_orders o ON o.id = l.order_id
    JOIN stores s ON s.id = o.store_id
    WHERE regexp_replace(o.shopify_order_number, '^#', '') ILIKE ${nhu}
       OR l.sku ILIKE ${nhu}
       OR l.product_title ILIKE ${nhu}
       OR o.customer_email ILIKE ${nhu}
    ORDER BY o.processed_at_shopify DESC NULLS LAST
    LIMIT 40`);
  return rows<Record<string, unknown>>(r).map((x) => ({
    lineId: String(x.line_id),
    maDon: String(x.ma_don),
    store: (x.store as string) ?? null,
    sku: (x.sku as string) ?? null,
    tenSanPham: (x.product_title as string) ?? null,
    bienThe: (x.variant_title as string) ?? null,
    soLuong: Number(x.quantity),
    khachEmail: (x.customer_email as string) ?? null,
  }));
}
