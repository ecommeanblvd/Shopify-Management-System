/**
 * Đẩy một dòng wh_nhan_kcs sang Lark. SMS đã lưu việc của kho TRƯỚC, nên Lark hỏng chỉ làm
 * chậm chứ không làm mất việc: dòng nằm ở trạng thái 'loi' và cron thử lại.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ghiDongKho } from '@/features/lark/wh-inventory';
import type { ViecNhanKcs, QcCheck, WhAction, Warehouse } from './gia-tri-lark';

export type CheDoGhi = { kieu: 'dry' } | { kieu: 'that' } | { kieu: 'chon'; dinhDanhs: string[] };

/**
 * THUẦN: đọc env ra chế độ ghi Lark.
 *
 * 'chon:<định danh>,<định danh>' là chế độ nằm GIỮA chạy thử và chạy thật (CEO 23/09/2026):
 * kiểm từng bản ghi một mà không sợ lỡ tay ghi hàng loạt lên bảng 9.007 dòng của kho.
 */
export function docCheDoGhi(env: string | undefined): CheDoGhi {
  const s = (env ?? '').trim();
  if (!s) return { kieu: 'that' };
  if (s.toLowerCase() === 'dry') return { kieu: 'dry' };
  if (s.toLowerCase().startsWith('chon:')) {
    return { kieu: 'chon', dinhDanhs: s.slice(5).split(',').map((x) => x.trim()).filter(Boolean) };
  }
  return { kieu: 'that' };
}

/** Món này có được ghi thật lên Lark không. */
export function duocGhi(cheDo: CheDoGhi, monDinhDanh: string): boolean {
  if (cheDo.kieu === 'that') return true;
  if (cheDo.kieu === 'dry') return false;
  return cheDo.dinhDanhs.includes(monDinhDanh);
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

  const cheDo = docCheDoGhi(process.env.WH_GHI_LARK);
  if (!duocGhi(cheDo, d.monDinhDanh)) {
    console.log('[kho-nhan] KHÔNG gửi Lark (chế độ %s):', cheDo.kieu, { don: d.orderNumber, sku: d.sku, mon: d.monDinhDanh });
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
