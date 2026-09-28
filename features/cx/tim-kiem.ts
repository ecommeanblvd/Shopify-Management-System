'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { coGiDeXem, quyenCx } from './quyen';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

export interface HoSoTim {
  module: 'ticket' | 'doi_tra' | 'tranh_chap' | 'su_co' | 'danh_gia';
  id: string;
  ma: string;
  nhan: string;
  phu: string | null;
  maDon: string | null;
  href: string;
}

export interface KetQuaTimCx {
  hoSo: HoSoTim[];
  /** Module người này không xem được — nói rõ thay vì im lặng thiếu kết quả. */
  khongXemDuoc: string[];
}

const TOI_THIEU = 3;

/**
 * Tìm xuyên module theo MÃ ĐƠN hoặc EMAIL KHÁCH.
 *
 * Đây là phiên bản rẻ của "nhìn một đơn có gì": đo 28/09 chỉ 15/616 đơn (2,4%) có
 * hồ sơ ở nhiều hơn một module, nên một màn 360° riêng sẽ trống 97,6% số lần mở.
 * Dưới dạng kết quả tìm, một hồ sơ là một dòng — không phải một trang trống.
 *
 * Lọc quyền ở ĐÂY, không ở tầng hiển thị: người chỉ có `cx.review` gõ mã đơn thì
 * số tiền tranh chấp của đơn đó không được rời máy chủ.
 */
export async function timXuyenModule(tuKhoa: string): Promise<KetQuaTimCx> {
  const q = await quyenCx();
  if (!coGiDeXem(q)) throw new Error('Không có quyền xem workspace CX.');

  const ky = tuKhoa.trim();
  if (ky.length < TOI_THIEU) return { hoSo: [], khongXemDuoc: [] };
  // Bỏ '#' đầu để gõ '#MBLVD123' hay 'MBLVD123' đều ra kết quả.
  const don = `%${ky.replace(/^#/, '')}%`;
  const em = `%${ky}%`;

  const hoSo: HoSoTim[] = [];
  const khongXemDuoc: string[] = [];

  if (q.ticket) {
    const r = await db.execute(sql`
      SELECT DISTINCT t.id, t.ma_ticket, t.tieu_de, t.trang_thai,
             o.shopify_order_number AS ma_don
      FROM cx_ticket t
      LEFT JOIN cx_ticket_dong d ON d.ticket_id = t.id
      LEFT JOIN shopify_order_lines l ON l.id = d.order_line_id
      LEFT JOIN shopify_orders o ON o.id = l.order_id
      WHERE regexp_replace(COALESCE(o.shopify_order_number, ''), '^#', '') ILIKE ${don}
         OR t.khach_email ILIKE ${em}
         OR t.ma_ticket ILIKE ${em}
      LIMIT 25`);
    for (const x of rows<Record<string, unknown>>(r)) {
      hoSo.push({
        module: 'ticket', id: String(x.id), ma: String(x.ma_ticket),
        nhan: String(x.tieu_de), phu: String(x.trang_thai),
        maDon: (x.ma_don as string) ?? null, href: '/f/cx/viec-can-lam',
      });
    }
  } else khongXemDuoc.push('Việc cần làm');

  if (q.doiTra) {
    const r = await db.execute(sql`
      SELECT r.id, r.rma_code, r.item_name, r.status, r.order_number, o.customer_email
      FROM customer_order_requests r
      LEFT JOIN shopify_orders o ON o.id = r.order_id
      WHERE r.rma_code IS NOT NULL
        AND (regexp_replace(COALESCE(r.order_number, ''), '^#', '') ILIKE ${don}
             OR o.customer_email ILIKE ${em}
             OR r.rma_code ILIKE ${em})
      LIMIT 25`);
    for (const x of rows<Record<string, unknown>>(r)) {
      hoSo.push({
        module: 'doi_tra', id: String(x.id), ma: String(x.rma_code),
        nhan: String(x.item_name ?? 'yêu cầu trả'), phu: String(x.status),
        maDon: (x.order_number as string) ?? null,
        href: '/f/customer-account/requests',
      });
    }
  } else khongXemDuoc.push('Đổi trả');

  if (q.tranhChap) {
    const r = await db.execute(sql`
      SELECT id, ma_ho_so, shopify_dispute_id, so_tien, tien_te, trang_thai, ma_don, khach_email
      FROM dispute
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') ILIKE ${don}
         OR khach_email ILIKE ${em}
         OR COALESCE(ma_ho_so, '') ILIKE ${em}
      LIMIT 25`);
    for (const x of rows<Record<string, unknown>>(r)) {
      hoSo.push({
        module: 'tranh_chap', id: String(x.id),
        ma: String(x.ma_ho_so ?? x.shopify_dispute_id ?? ''),
        nhan: `${x.tien_te} ${Number(x.so_tien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}`,
        phu: String(x.trang_thai),
        maDon: (x.ma_don as string) ?? null, href: '/f/cx/tranh-chap',
      });
    }
  } else khongXemDuoc.push('Tranh chấp');

  if (q.suCo) {
    const r = await db.execute(sql`
      SELECT id, ma_su_co, nguyen_nhan, trang_thai, ma_don,
             (SELECT COALESCE(sum(c.so_tien), 0) FROM su_co_chi_phi c WHERE c.su_co_id = su_co.id) AS tien,
             (SELECT max(c.tien_te) FROM su_co_chi_phi c WHERE c.su_co_id = su_co.id) AS tien_te
      FROM su_co
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') ILIKE ${don}
         OR ma_su_co ILIKE ${em}
      LIMIT 25`);
    for (const x of rows<Record<string, unknown>>(r)) {
      const tien = Number(x.tien ?? 0);
      hoSo.push({
        module: 'su_co', id: String(x.id), ma: String(x.ma_su_co),
        nhan: String(x.nguyen_nhan),
        phu: [
          x.trang_thai,
          tien > 0 ? `${x.tien_te ?? ''} ${tien.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}`.trim() : null,
        ].filter(Boolean).join(' · '),
        maDon: (x.ma_don as string) ?? null, href: '/f/cx/su-co',
      });
    }
  } else khongXemDuoc.push('Sự cố');

  if (q.danhGia) {
    const r = await db.execute(sql`
      SELECT id, ma_danh_gia, so_sao, noi_dung, vendor, ma_don, khach_email
      FROM danh_gia
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') ILIKE ${don}
         OR khach_email ILIKE ${em}
         OR ma_danh_gia ILIKE ${em}
      LIMIT 25`);
    for (const x of rows<Record<string, unknown>>(r)) {
      hoSo.push({
        module: 'danh_gia', id: String(x.id), ma: String(x.ma_danh_gia),
        nhan: `${'★'.repeat(Number(x.so_sao))} ${String(x.noi_dung ?? '').slice(0, 60)}`.trim(),
        phu: (x.vendor as string) ?? null,
        maDon: (x.ma_don as string) ?? null, href: '/f/cx/danh-gia',
      });
    }
  } else khongXemDuoc.push('Đánh giá');

  return { hoSo, khongXemDuoc };
}
