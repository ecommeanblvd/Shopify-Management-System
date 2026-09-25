'use server';

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { searchWhInventoryByNgay } from '@/features/lark/client';
import { requirePerm } from '@/features/receiving/perm';
import { MUI_GIO_KINH_DOANH, sqlGioKinhDoanh } from '@/lib/timezone';
import { doiChieu } from './doi-chieu-logic';
import type { KetQuaDoiChieu } from './doi-chieu-logic';

/** 00:00 GIỜ VIỆT NAM của một ngày 'YYYY-MM-DD', tính bằng ms.
 *
 *  Lấy 00:00 UTC rồi trừ đi độ lệch múi giờ — không hằng số 7 tiếng viết cứng,
 *  để nếu công ty đổi múi giờ nghiệp vụ thì chỗ này đi theo. */
function mocDauNgay(ngay: string): number {
  const utc = Date.parse(`${ngay}T00:00:00Z`);
  const lech = new Date(utc).toLocaleString('en-US', { timeZone: MUI_GIO_KINH_DOANH, timeZoneName: 'longOffset' });
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(lech);
  if (!m) return utc;
  const phut = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === '-' ? -1 : 1);
  return utc - phut * 60_000;
}

function chuoi(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : (x as { text?: string })?.text ?? '')).join('') || null;
  if (typeof v === 'object') return (v as { text?: string }).text ?? null;
  return String(v);
}

/**
 * Đối chiếu MỘT ngày: sổ bên mình so với bảng Lark.
 *
 * Chỉ ĐỌC — không tự sửa bên nào. Hai hệ thống đang chạy song song, mỗi bên có
 * lý do riêng để có dòng bên kia không có; máy tự "đồng bộ" là tự ý sửa bảng
 * vận hành của cả đội. Việc của trang này là CHỈ RA chỗ lệch cho người quyết.
 */
export async function doiChieuNgay(ngay: string): Promise<{ ok: boolean; ket?: KetQuaDoiChieu; loi?: string }> {
  await requirePerm('view_receiving');
  try {
    const cuaMinh = await db.select({
      unitCode: schema.goodsReceiptItems.unitCode,
      maDon: schema.shopifyOrders.shopifyOrderNumber,
      sku: schema.goodsReceiptItems.sku,
      larkRecordId: schema.goodsReceiptItems.larkRecordId,
    })
      .from(schema.goodsReceiptItems)
      .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
      .where(and(sql`${sql.raw(sqlGioKinhDoanh('goods_receipt_items.created_at'))}::date = ${ngay}::date`));

    const tho = await searchWhInventoryByNgay(mocDauNgay(ngay));
    const tuLark = tho.map((r) => ({
      recordId: r.record_id,
      maDon: chuoi(r.fields['Order Number final']),
      sku: chuoi(r.fields['Lineitem SKU final']),
    }));

    return { ok: true, ket: doiChieu(cuaMinh, tuLark) };
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    console.error('[kho-nhan] doiChieuNgay lỗi:', e);
    return { ok: false, loi: `Không đối chiếu được: ${loi}` };
  }
}
