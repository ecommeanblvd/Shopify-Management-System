'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { tachMaDon, laHangHoan, chiaTheoCan, hopLyTheoNgay } from './tach-ma-don';

export interface KetQuaPhanBo {
  /** Dòng bill có order_number nhưng KHÔNG khớp tuyệt đối đơn nào. */
  daXet: number;
  /** Dòng là hàng hoàn → bỏ (cước hoàn đi đường return_of_order_id). */
  boHangHoan: number;
  /** Bóc được mã nhưng không tìm thấy đơn nào trong hệ thống (mã cụt / đơn store khác). */
  khongTimThayDon: number;
  /** Không bóc được mã nào (chuỗi rác). */
  khongCoMa: number;
  /** Số dòng đã phân bổ + số bản ghi phân bổ tạo ra. */
  daPhanBo: number;
  soBanGhi: number;
  tienPhanBo: number;
  /** Phải chia đều vì thiếu cân — cần người soát. */
  chiaDeu: Array<{ maBill: string; donHang: string[] }>;
  /** Bóc được mã nhưng thiếu đơn → liệt kê để người xử tay. */
  boSot: Array<{ orderNumber: string; total: number; maTimKhongRa: string[] }>;
  /** Bị RÀO NGÀY chặn (mã cắt cụt trùng đơn cũ) — không gán, liệt kê để soát. */
  chanTheoNgay: Array<{ orderNumber: string; don: string; ngayDon: string; ngayBill: string }>;
}

/**
 * Quét các dòng hoá đơn KHÔNG khớp tuyệt đối đơn nào, bóc mã đơn từ ô chữ tự do
 * rồi chia tiền theo CÂN từng đơn (CEO chốt 04/09) vào `bill_line_allocations`.
 *
 * Idempotent: ghi đè phân bổ cũ của đúng dòng đó (ON CONFLICT), nên chạy lại
 * nhiều lần không nhân đôi tiền.
 *
 * CHỈ xét dòng KHÔNG khớp tuyệt đối — dòng đã khớp thì đường cũ lo, tránh một
 * dòng vừa được cộng qua đường khớp-tuyệt-đối vừa cộng qua phân bổ (đếm đôi).
 */
export async function phanBoBillNhieuDon(): Promise<KetQuaPhanBo> {
  const kq: KetQuaPhanBo = {
    daXet: 0, boHangHoan: 0, khongTimThayDon: 0, khongCoMa: 0,
    daPhanBo: 0, soBanGhi: 0, tienPhanBo: 0, chiaDeu: [], boSot: [], chanTheoNgay: [],
  };

  const { rows } = await db.$client.query(`
    SELECT l.id, l.order_number, l.total::float8 AS total,
           COALESCE(l.ship_date, b.period_end, l.created_at) AS ngay_bill
    FROM carrier_bill_lines l
    JOIN carrier_bills b ON b.id = l.bill_id
    WHERE l.order_number IS NOT NULL AND btrim(l.order_number) <> ''
      AND l.return_of_order_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM shopify_orders o
        WHERE replace(o.shopify_order_number, '#', '') = replace(l.order_number, '#', ''))
  `);

  for (const r of rows as Array<{ id: string; order_number: string; total: number; ngay_bill: string | null }>) {
    kq.daXet += 1;
    if (laHangHoan(r.order_number)) { kq.boHangHoan += 1; continue; }
    const ma = tachMaDon(r.order_number);
    if (ma.length === 0) { kq.khongCoMa += 1; continue; }

    const { rows: ungVien } = await db.$client.query(
      `SELECT id, shopify_order_number AS so, ship_weight_kg::float8 AS kg, processed_at_shopify AS d
       FROM shopify_orders
       WHERE replace(upper(shopify_order_number), '#', '') = ANY($1::text[])`,
      [ma],
    );
    // RÀO NGÀY: ô mã đơn trên hoá đơn bị cắt cụt ở 24 ký tự nên mã cụt có thể
    // trùng một đơn CŨ có thật (bắt được ca 2021 lẫn vào bill 2026). Xem
    // hopLyTheoNgay trong tach-ma-don.ts.
    const ngayBill = r.ngay_bill ? new Date(r.ngay_bill) : null;
    const don = (ungVien as Array<Record<string, unknown>>).filter((d) => {
      const ok = hopLyTheoNgay(d.d ? new Date(String(d.d)) : null, ngayBill);
      if (!ok) kq.chanTheoNgay.push({
        orderNumber: r.order_number, don: String(d.so),
        ngayDon: d.d ? String(d.d).slice(0, 10) : '(trống)',
        ngayBill: ngayBill ? ngayBill.toISOString().slice(0, 10) : '(trống)',
      });
      return ok;
    });
    if (don.length === 0) {
      kq.khongTimThayDon += 1;
      kq.boSot.push({ orderNumber: r.order_number, total: r.total, maTimKhongRa: ma });
      continue;
    }
    if (don.length < ma.length) {
      kq.boSot.push({
        orderNumber: r.order_number, total: r.total,
        maTimKhongRa: ma.filter((m) => !don.some((d: Record<string, unknown>) => String(d.so).replace(/^#/, '').toUpperCase() === m)),
      });
    }

    const phan = chiaTheoCan(r.total, (don as Array<Record<string, unknown>>).map((d) => ({
      so: String(d.so).replace(/^#/, '').toUpperCase(), kg: d.kg == null ? null : Number(d.kg),
    })));
    const theoSo = new Map((don as Array<Record<string, unknown>>).map((d) => [String(d.so).replace(/^#/, '').toUpperCase(), d]));

    // Dọn phân bổ cũ của chính dòng này trước khi ghi lại — lần chạy trước có
    // thể đã gán nhầm (trước khi có rào ngày), upsert đơn thuần không xoá được.
    await db.$client.query(`DELETE FROM bill_line_allocations WHERE bill_line_id = $1`, [r.id]);
    for (const p of phan) {
      const d = theoSo.get(p.so)!;
      await db.$client.query(
        `INSERT INTO bill_line_allocations (bill_line_id, order_id, amount_vnd, weight_kg, split_even)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bill_line_id, order_id)
         DO UPDATE SET amount_vnd = EXCLUDED.amount_vnd, weight_kg = EXCLUDED.weight_kg, split_even = EXCLUDED.split_even`,
        [r.id, d.id, p.tien, d.kg ?? null, p.chiaDeuVìThieuCan],
      );
      kq.soBanGhi += 1;
      kq.tienPhanBo += p.tien;
    }
    kq.daPhanBo += 1;
    if (phan.some((p) => p.chiaDeuVìThieuCan)) kq.chiaDeu.push({ maBill: r.order_number, donHang: phan.map((p) => p.so) });
  }
  return kq;
}
