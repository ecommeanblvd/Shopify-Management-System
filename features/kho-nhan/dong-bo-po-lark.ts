/**
 * Đồng bộ bảng PO trên Lark về SMS (CEO 29/09/2026).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của cron, không phải endpoint.
 *
 * Bảng PO nằm ở base WH (`HxfAw0iRViHiNgkSlbBltpVkg3f`), table `tblrbN04rB1FOixv`.
 * CHỈ ĐỌC. Ô tìm của màn Nhận hàng chạy theo từng phím gõ nên phải soi bản sao,
 * không gọi Lark từng lượt.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listPoRecords, type LarkRecord } from '@/features/lark/client';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';
import { boDauTiengViet } from '@/features/kol/bo-dau';

const chu = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x as { text?: string })?.text ?? String(x)).join('');
  if (typeof v === 'object') return (v as { text?: string }).text ?? '';
  return String(v);
};
const rong = (v: unknown): string | null => { const s = chu(v).trim(); return s === '' ? null : s; };

/** Mốc ms của Lark → ngày NGHIỆP VỤ 'YYYY-MM-DD'. */
function ngay(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return new Date(v).toLocaleDateString('en-CA', { timeZone: MUI_GIO_KINH_DOANH });
}

/** THUẦN: một record Lark → dòng PO. Số lượng thiếu/không đọc được coi là 1 —
 *  bảng thật mỗi dòng một chiếc, và 0 sẽ làm PO trông như đã nhập đủ. */
export function dungDongPo(r: LarkRecord) {
  const f = r.fields;
  const sl = Number(chu(f['Lineitem quantity']));
  const gia = Number(chu(f['Lineitem price']));
  return {
    recordId: r.record_id,
    dinhDanh: rong(f['Định danh']),
    orderNumber: rong(f['Order Number']),
    ngayDat: ngay(f['Date order']),
    baoDon: f['Báo đơn'] === true,
    vendor: rong(f.Vendor),
    lineitemName: rong(f['Lineitem name']),
    sku: rong(f['Lineitem sku']),
    soLuong: Number.isFinite(sl) && sl > 0 ? Math.round(sl) : 1,
    donGia: Number.isFinite(gia) ? String(gia) : null,
    parentItems: rong(f['Parent items']),
    sourceId: rong(f.SourceID),
    timKiem: boDauTiengViet(`${chu(f['Lineitem name'])} ${chu(f['Lineitem sku'])}`).toLowerCase(),
    capNhatLuc: new Date(),
  };
}

export async function dongBoPoLark(): Promise<{ doc: number; ghi: number; daTick: number }> {
  const ds = await listPoRecords();
  const dong = ds.map(dungDongPo);
  let ghi = 0;
  // Chia lô 500: một câu insert nghìn dòng vượt trần tham số của Postgres.
  for (let i = 0; i < dong.length; i += 500) {
    const lo = dong.slice(i, i + 500);
    await db.insert(schema.larkPoDong).values(lo).onConflictDoUpdate({
      target: schema.larkPoDong.recordId,
      set: {
        dinhDanh: sql`excluded.dinh_danh`, orderNumber: sql`excluded.order_number`,
        ngayDat: sql`excluded.ngay_dat`, baoDon: sql`excluded.bao_don`,
        vendor: sql`excluded.vendor`, lineitemName: sql`excluded.lineitem_name`,
        sku: sql`excluded.sku`, soLuong: sql`excluded.so_luong`,
        donGia: sql`excluded.don_gia`, parentItems: sql`excluded.parent_items`,
        sourceId: sql`excluded.source_id`, timKiem: sql`excluded.tim_kiem`,
        capNhatLuc: sql`excluded.cap_nhat_luc`,
      },
    });
    ghi += lo.length;
  }
  return { doc: ds.length, ghi, daTick: dong.filter((d) => d.baoDon).length };
}
