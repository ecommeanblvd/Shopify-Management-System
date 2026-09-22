/**
 * Đẩy một dòng wh_nhan_kcs sang Lark. SMS đã lưu việc của kho TRƯỚC, nên Lark hỏng chỉ làm
 * chậm chứ không làm mất việc: dòng nằm ở trạng thái 'loi' và cron thử lại.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ghiDongKho } from '@/features/lark/wh-inventory';
import type { ViecNhanKcs, QcCheck, WhAction, Warehouse } from './gia-tri-lark';

/** THUẦN: env có bật chế độ thử không (ghi log, không gọi Lark). */
export function laDry(env: string | undefined): boolean {
  return (env ?? '').trim().toLowerCase() === 'dry';
}

/**
 * `dry` = chạy thử, KHÔNG gửi gì sang Lark; `tao` = thật sự vừa tạo dòng mới (khác với "vừa
 * cập nhật dòng có sẵn"). Màn hình đọc đúng hai cờ này để không khoe "đã tạo dòng trên Lark"
 * khi chưa gửi gì cả.
 */
export interface KetQuaDay { ok: boolean; dry?: boolean; tao?: boolean; loi?: string }

export async function dayMotDong(id: string): Promise<KetQuaDay> {
  const [d] = await db.select().from(schema.whNhanKcs).where(eq(schema.whNhanKcs.id, id)).limit(1);
  if (!d) return { ok: false, loi: 'không thấy dòng' };
  // Đã đẩy rồi thì dòng trên Lark có sẵn, lần này không tạo thêm.
  if (d.trangThaiDay === 'da_day') return { ok: true, tao: false };

  if (laDry(process.env.WH_GHI_LARK)) {
    console.log('[kho-nhan] DRY — không gửi Lark:', { don: d.orderNumber, sku: d.sku, qc: d.qcCheck });
    return { ok: true, dry: true };
  }

  const viec: ViecNhanKcs = {
    monDinhDanh: d.monDinhDanh, monRecordId: d.monRecordId, orderNumber: d.orderNumber, sku: d.sku,
    lineitemName: null, store: null, vendor: null,
    soLuong: d.soLuong, canKg: d.canKg != null ? Number(d.canKg) : null,
    qcCheck: d.qcCheck as QcCheck, whAction: d.whAction as WhAction,
    lyDoFail: d.lyDoFail, warehouse: d.warehouse as Warehouse,
  };
  // Tên hàng / store / vendor lấy lại từ món để dòng mới trên Lark đủ thông tin.
  const [mon] = await db.select({
    lineitemName: schema.larkMonDon.lineitemName, store: schema.larkMonDon.store, vendor: schema.larkMonDon.vendor,
  }).from(schema.larkMonDon).where(eq(schema.larkMonDon.dinhDanh, d.monDinhDanh)).limit(1);
  if (mon) Object.assign(viec, mon);

  try {
    const r = await ghiDongKho(viec, d.luc);
    await db.update(schema.whNhanKcs)
      .set({ trangThaiDay: 'da_day', larkRecordId: r.larkRecordId, loi: null, lanDayCuoi: new Date() })
      .where(eq(schema.whNhanKcs.id, id));
    return { ok: true, tao: r.tao };
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    await db.update(schema.whNhanKcs)
      .set({ trangThaiDay: 'loi', loi: loi.slice(0, 500), lanDayCuoi: new Date() })
      .where(eq(schema.whNhanKcs.id, id));
    return { ok: false, loi };
  }
}

/** Cron: đẩy lại các dòng còn 'cho' hoặc 'loi'. */
export async function dayLaiDongCho(gioiHan = 100): Promise<{ da: number; loi: number }> {
  const ds = await db.select({ id: schema.whNhanKcs.id }).from(schema.whNhanKcs)
    .where(inArray(schema.whNhanKcs.trangThaiDay, ['cho', 'loi']))
    .limit(gioiHan);
  let da = 0, loi = 0;
  for (const d of ds) {
    const r = await dayMotDong(d.id);
    if (r.ok) da++; else loi++;
  }
  return { da, loi };
}
