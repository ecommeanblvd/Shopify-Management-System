'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { gomTheoTienTe, type TongTheoTien } from '@/features/dispute/tong-tien';
import { coGiDeXem, quyenCx } from './quyen';
import { xepViec, type KetQuaXep, type Viec } from './uu-tien';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/** Số ngày còn lại tới một mốc, làm tròn LÊN — còn 6 tiếng vẫn là 1 ngày. */
function conLai(han: unknown, moc: Date): number | null {
  if (han == null) return null;
  const d = new Date(han as string);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - moc.getTime()) / 86_400_000);
}

export interface SoLieuNhanh {
  thietHaiThangNay: TongTheoTien[];
  tranhChapDangMo: TongTheoTien[];
  motSaoThangNay: number;
}

export interface TongQuanCx {
  xep: KetQuaXep;
  soLieu: SoLieuNhanh;
  /** Module nào người này không xem được — để nói rõ thay vì im lặng thiếu số. */
  khongXemDuoc: string[];
}

/**
 * Việc đang treo ở mọi module, ĐÃ lọc theo quyền người xem.
 *
 * KHÔNG `LIMIT` truy vấn nào, và KHÔNG có bộ đếm riêng. Bản đầu lấy 50–100 dòng
 * mỗi module rồi đếm bằng `count(*)` riêng để bù — nhưng bù thiếu: `tongNgay` và
 * `tongTonDong` vẫn tính trên danh sách đã cắt, nên trang báo 170 trong khi thật
 * có 190 (LIMIT 100 cắt mất 20 sự cố). Hai nguồn sự thật thì sớm muộn cũng lệch.
 *
 * Giờ lấy HẾT rồi để hàm thuần `xepViec` vừa cắt còn 5 việc mỗi khối vừa giữ tổng
 * thật. Bị chặn tự nhiên vì chỉ lấy việc CÒN TREO: 191 dòng ngày 28/09.
 */
export async function tongQuanCx(): Promise<TongQuanCx> {
  const q = await quyenCx();
  if (!coGiDeXem(q)) throw new Error('Không có quyền xem workspace CX.');
  const moc = new Date();
  const viec: Viec[] = [];
  const khongXemDuoc: string[] = [];

  if (q.tranhChap) {
    const r = await db.execute(sql`
      SELECT id, so_tien, tien_te, ma_don, han_nop, lark_record_id
      FROM dispute
      WHERE trang_thai IN ('needs_response', 'under_review') AND da_nop_luc IS NULL
      ORDER BY han_nop ASC NULLS LAST`);
    for (const x of rows<Record<string, unknown>>(r)) {
      viec.push({
        id: String(x.id), loai: 'tranh_chap',
        nhan: `${x.tien_te} ${Number(x.so_tien).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}`,
        phu: (x.ma_don as string) ?? null,
        conLai: conLai(x.han_nop, moc),
        tuLark: x.lark_record_id != null,
        href: '/f/cx/tranh-chap',
      });
    }
  } else khongXemDuoc.push('Tranh chấp');

  if (q.doiTra) {
    const r = await db.execute(sql`
      SELECT r.id, r.rma_code, r.item_name, r.order_number, r.status
      FROM customer_order_requests r
      WHERE r.rma_code IS NOT NULL
        AND r.status NOT IN ('refunded', 'rejected', 'cancelled')
      ORDER BY r.created_at ASC`);
    for (const x of rows<Record<string, unknown>>(r)) {
      viec.push({
        id: String(x.id), loai: 'doi_tra',
        nhan: String(x.rma_code ?? x.order_number ?? 'yêu cầu trả'),
        phu: [x.item_name, x.status].filter(Boolean).join(' · ') || null,
        conLai: null, tuLark: false,
        href: '/f/customer-account/requests',
      });
    }
  } else khongXemDuoc.push('Đổi trả');

  if (q.danhGia) {
    const r = await db.execute(sql`
      SELECT id, so_sao, vendor, ma_don, noi_dung, lark_record_id
      FROM danh_gia
      WHERE so_sao <= 2 AND COALESCE(trang_thai, '') NOT IN ('responded', 'archived')
      ORDER BY ngay DESC`);
    for (const x of rows<Record<string, unknown>>(r)) {
      viec.push({
        id: String(x.id), loai: 'danh_gia',
        nhan: `${'★'.repeat(Number(x.so_sao))} ${String(x.noi_dung ?? '').slice(0, 70) || '(không có nội dung)'}`,
        phu: [x.vendor, x.ma_don].filter(Boolean).join(' · ') || null,
        conLai: null,
        tuLark: x.lark_record_id != null,
        href: '/f/cx/danh-gia?cc=1',
      });
    }
  } else khongXemDuoc.push('Đánh giá');

  if (q.ticket) {
    // Ticket CÓ hạn xử lý là loại riêng (ưu tiên 4); ticket không hạn là loại 7.
    const r = await db.execute(sql`
      SELECT t.id, t.ma_ticket, t.tieu_de, t.han_xu_ly, t.nguon,
             (SELECT count(*)::int FROM cx_ticket_phan_viec p
               WHERE p.ticket_id = t.id AND p.trang_thai <> 'da_xu_ly') AS con_tac
      FROM cx_ticket t
      WHERE t.trang_thai <> 'xong'
      ORDER BY t.han_xu_ly ASC NULLS LAST, t.created_at DESC`);
    for (const x of rows<Record<string, unknown>>(r)) {
      const cl = conLai(x.han_xu_ly, moc);
      viec.push({
        id: String(x.id),
        loai: cl != null ? 'ticket_han' : 'ticket',
        nhan: String(x.tieu_de),
        phu: [x.ma_ticket, Number(x.con_tac) > 0 ? `${x.con_tac} bộ phận chưa xong` : null]
          .filter(Boolean).join(' · ') || null,
        conLai: cl,
        tuLark: x.nguon === 'lark',
        href: '/f/cx/viec-can-lam',
      });
    }
  } else khongXemDuoc.push('Việc cần làm');

  if (q.suCo) {
    const r = await db.execute(sql`
      SELECT s.id, s.ma_su_co, s.nguyen_nhan, s.ma_don, s.can_xem_lai, s.lark_record_id,
             (SELECT COALESCE(sum(c.so_tien), 0) FROM su_co_chi_phi c WHERE c.su_co_id = s.id) AS tien,
             (SELECT max(c.tien_te) FROM su_co_chi_phi c WHERE c.su_co_id = s.id) AS tien_te
      FROM su_co s
      WHERE s.trang_thai <> 'xong' OR s.can_xem_lai
      ORDER BY s.can_xem_lai DESC, s.ngay_bao DESC`);
    for (const x of rows<Record<string, unknown>>(r)) {
      const tien = Number(x.tien ?? 0);
      viec.push({
        id: String(x.id),
        loai: x.can_xem_lai ? 'su_co_xem_lai' : 'su_co',
        nhan: String(x.nguyen_nhan),
        phu: [
          x.ma_su_co,
          tien > 0 ? `${x.tien_te ?? ''} ${tien.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}`.trim() : null,
          x.ma_don,
        ].filter(Boolean).join(' · ') || null,
        conLai: null,
        tuLark: x.lark_record_id != null,
        href: x.can_xem_lai ? '/f/cx/su-co?xl=1' : '/f/cx/su-co',
      });
    }
  } else khongXemDuoc.push('Sự cố');

  const xep = xepViec(viec);
  return { xep, soLieu: await soLieuNhanh(q.suCo, q.tranhChap, q.danhGia), khongXemDuoc };
}

async function soLieuNhanh(
  coSuCo: boolean, coTranhChap: boolean, coDanhGia: boolean,
): Promise<SoLieuNhanh> {
  const thietHai = coSuCo
    ? rows<Record<string, unknown>>(await db.execute(sql`
        SELECT c.so_tien, c.tien_te FROM su_co_chi_phi c JOIN su_co s ON s.id = c.su_co_id
        WHERE s.ngay_bao >= date_trunc('month', current_date)`))
    : [];
  const tranhChap = coTranhChap
    ? rows<Record<string, unknown>>(await db.execute(sql`
        SELECT so_tien, tien_te FROM dispute
        WHERE trang_thai IN ('needs_response', 'under_review')`))
    : [];
  const [dg] = coDanhGia
    ? rows<Record<string, unknown>>(await db.execute(sql`
        SELECT count(*)::int AS n FROM danh_gia
        WHERE so_sao = 1 AND ngay >= date_trunc('month', current_date)`))
    : [];
  return {
    thietHaiThangNay: gomTheoTienTe(thietHai.map((x) => ({ soTien: String(x.so_tien), tienTe: String(x.tien_te) }))),
    tranhChapDangMo: gomTheoTienTe(tranhChap.map((x) => ({ soTien: String(x.so_tien), tienTe: String(x.tien_te) }))),
    motSaoThangNay: Number(dg?.n ?? 0),
  };
}
