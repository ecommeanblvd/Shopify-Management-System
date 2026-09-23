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
 * Chuỗi DUY NHẤT bật ghi thật cho MỌI món — cố ý dài, lạ, không giống chữ ai gõ nhầm tay
 * (CEO 23/09/2026, sau khi review chỉ ra bản đầu "không nhận ra thì ghi thật" là bẫy: máy
 * mới chưa cấu hình biến, hay gõ nhầm "chọn:" có dấu thành thứ khác, đều lẽ ra phải AN TOÀN).
 */
export const GHI_THAT_TOAN_BO = 'ghi-that-toan-bo';

/**
 * THUẦN: đọc env ra chế độ ghi Lark. AN TOÀN LÀ MẶC ĐỊNH: bất cứ chuỗi nào không phải đúng
 * `GHI_THAT_TOAN_BO`, và không đúng dạng `chon:`/`chọn:` có ít nhất một định danh, đều là
 * chạy thử — kể cả biến trống, chưa đặt, hay gõ sai. Không có đường nào để một lỗi gõ vô
 * tình biến thành ghi hàng loạt lên bảng 9.007 dòng của kho.
 *
 * 'chon:<định danh>,<định danh>' (hoặc 'chọn:' có dấu — CEO gõ tay, cả hai cách đều nhận)
 * là chế độ nằm GIỮA chạy thử và chạy thật: chỉ những món khai tên mới ghi thật, còn lại vẫn
 * chỉ lưu trong SMS. Nhờ vậy kiểm từng bản ghi một mà không sợ lỡ tay ghi hàng loạt.
 */
export function docCheDoGhi(env: string | undefined): CheDoGhi {
  const s = (env ?? '').trim();
  const sl = s.toLowerCase();
  if (sl === GHI_THAT_TOAN_BO) return { kieu: 'that' };
  if (sl.startsWith('chon:') || sl.startsWith('chọn:')) {
    const dinhDanhs = s.slice(s.indexOf(':') + 1).split(',').map((x) => x.trim()).filter(Boolean);
    // Khai tiền tố nhưng không có định danh nào dùng được — KHÔNG có nghĩa "ghi hết", vẫn
    // chạy thử để không lỡ ghi tràn khi ai đó gõ dở dang.
    if (dinhDanhs.length === 0) return { kieu: 'dry' };
    return { kieu: 'chon', dinhDanhs };
  }
  return { kieu: 'dry' };
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
