'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { quyenCx } from './quyen';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

export interface LienQuan {
  module: string;
  ten: string;
  so: number;
  href: string;
}

/**
 * Hồ sơ Ở MODULE KHÁC của cùng một mã đơn.
 *
 * `boQua` là module đang mở, để không kể lại chính nó.
 *
 * Trả MẢNG RỖNG khi không có gì — UI không hiện dòng "không có hồ sơ liên quan",
 * vì đo 28/09 thì 97,6% đơn chỉ có hồ sơ ở một module: dòng đó sẽ hiện gần như
 * mọi lần mở và chỉ làm nhiễu.
 */
export async function hoSoLienQuan(maDon: string, boQua: string): Promise<LienQuan[]> {
  const q = await quyenCx();
  const ma = maDon.trim().replace(/^#/, '');
  if (!ma) return [];

  const ra: LienQuan[] = [];

  if (q.ticket && boQua !== 'ticket') {
    const [c] = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT count(DISTINCT t.id)::int AS n
      FROM cx_ticket t
      JOIN cx_ticket_dong d ON d.ticket_id = t.id
      JOIN shopify_order_lines l ON l.id = d.order_line_id
      JOIN shopify_orders o ON o.id = l.order_id
      WHERE regexp_replace(o.shopify_order_number, '^#', '') = ${ma}`));
    if (Number(c?.n ?? 0) > 0) {
      ra.push({ module: 'ticket', ten: 'ticket', so: Number(c!.n), href: '/f/cx/viec-can-lam' });
    }
  }

  if (q.doiTra && boQua !== 'doi_tra') {
    const [c] = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT count(*)::int AS n FROM customer_order_requests
      WHERE rma_code IS NOT NULL
        AND regexp_replace(COALESCE(order_number, ''), '^#', '') = ${ma}`));
    if (Number(c?.n ?? 0) > 0) {
      ra.push({ module: 'doi_tra', ten: 'yêu cầu trả', so: Number(c!.n), href: '/f/customer-account/requests' });
    }
  }

  if (q.tranhChap && boQua !== 'tranh_chap') {
    const [c] = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT count(*)::int AS n FROM dispute
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') = ${ma}`));
    if (Number(c?.n ?? 0) > 0) {
      ra.push({ module: 'tranh_chap', ten: 'tranh chấp', so: Number(c!.n), href: '/f/cx/tranh-chap' });
    }
  }

  if (q.suCo && boQua !== 'su_co') {
    const [c] = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT count(*)::int AS n FROM su_co
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') = ${ma}`));
    if (Number(c?.n ?? 0) > 0) {
      ra.push({ module: 'su_co', ten: 'sự cố', so: Number(c!.n), href: '/f/cx/su-co' });
    }
  }

  if (q.danhGia && boQua !== 'danh_gia') {
    const [c] = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT count(*)::int AS n FROM danh_gia
      WHERE regexp_replace(COALESCE(ma_don, ''), '^#', '') = ${ma}`));
    if (Number(c?.n ?? 0) > 0) {
      ra.push({ module: 'danh_gia', ten: 'đánh giá', so: Number(c!.n), href: '/f/cx/danh-gia' });
    }
  }

  return ra;
}
