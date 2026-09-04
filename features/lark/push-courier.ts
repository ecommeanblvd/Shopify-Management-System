import { searchRecordsByOrderNumber, updateLogRecordFields } from './client';
import { tenCourierLark } from './courier-name';

/** Tên cột trên bảng logistics. Đổi tên cột bên Lark là hỏng — nên để một chỗ. */
export const COT_COURIER = 'Couriers';

export interface KetQuaDayCourier {
  ok: boolean;
  /** Số record Lark đã ghi. */
  daGhi: number;
  /** Ghi được rồi thì đây là tên đã ghi (để UI hiện lại cho staff yên tâm). */
  ten?: string;
  error?: string;
}

/**
 * Đẩy hãng đã chọn sang cột "Couriers" của bảng Lark logistics, để bên lên vận
 * đơn và đóng hàng biết chạy hãng nào.
 *
 * Một đơn có thể có NHIỀU dòng Lark (mỗi kiện một dòng) → ghi hết, không chỉ
 * dòng đầu; bỏ sót dòng nào là kiện đó bị đóng nhầm hãng.
 *
 * KHÔNG ném lỗi ra ngoài: nhân viên đã chọn hãng xong trên hệ thống rồi, Lark
 * hỏng thì báo để họ điền tay chứ không được nuốt luôn thao tác chọn.
 */
export async function dayCourierLenLark(
  orderNumber: string | null | undefined,
  carrierKey: string,
): Promise<KetQuaDayCourier> {
  const ten = tenCourierLark(carrierKey);
  if (!ten) return { ok: false, daGhi: 0, error: `Chưa khai tên Lark cho hãng "${carrierKey}"` };
  if (!orderNumber?.trim()) return { ok: false, daGhi: 0, error: 'Đơn không có mã đơn hàng để tìm trên Lark' };

  try {
    const recs = await searchRecordsByOrderNumber(orderNumber);
    if (recs.length === 0) return { ok: false, daGhi: 0, error: `Không tìm thấy dòng Lark nào cho đơn ${orderNumber}` };

    let daGhi = 0;
    const loi: string[] = [];
    for (const r of recs) {
      // Đã đúng hãng rồi thì bỏ qua — khỏi ghi thừa lên bảng vận hành.
      if (r.fields[COT_COURIER] === ten) { daGhi += 1; continue; }
      try {
        await updateLogRecordFields(r.record_id, { [COT_COURIER]: ten });
        daGhi += 1;
      } catch (e) {
        loi.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (daGhi === 0) return { ok: false, daGhi: 0, error: loi[0] ?? 'Không ghi được dòng nào' };
    return { ok: loi.length === 0, daGhi, ten, error: loi.length ? `${loi.length}/${recs.length} dòng lỗi: ${loi[0]}` : undefined };
  } catch (e) {
    return { ok: false, daGhi: 0, error: e instanceof Error ? e.message : 'Lỗi gọi Lark' };
  }
}

/** Lấy "Order Number" từ record Lark (trường có thể là text hoặc mảng rich-text). */
export function soDonTuRecord(fields: Record<string, unknown>): string | null {
  const v = fields['Order Number'];
  const t = Array.isArray(v)
    ? (v[0] as { text?: string } | undefined)?.text
    : typeof v === 'string' ? v : null;
  return t ? t.trim().replace(/^#/, '') : null;
}

export interface KetQuaDongBoCourier {
  /** Đơn đã chọn hãng và có dòng Lark. */
  doiChieu: number;
  /** Ô Couriers còn trống → đã điền. */
  daDien: number;
  /** Ô đã có giá trị KHÁC → KHÔNG ghi đè, chỉ báo. */
  lechKhongGhi: Array<{ soDon: string; tenTrenLark: string; tenHeThong: string }>;
  loi: string[];
}

/**
 * Điền bù cột "Couriers" cho những đơn ĐÃ chọn hãng trên hệ thống nhưng lúc chọn
 * chưa có dòng Lark.
 *
 * Vì sao cần: dòng Lark chỉ sinh SAU khi đóng hàng/lên vận đơn — khảo sát 04/09,
 * 20 đơn mới nhất (tới 1,8 ngày tuổi) chưa đơn nào có dòng Lark. Nên ghi ngay lúc
 * nhân viên bấm chọn gần như luôn trượt; phải có bộ điền bù chạy theo nhịp sync.
 *
 * CHỈ ĐIỀN Ô TRỐNG. Ô đã có giá trị khác thì báo ra chứ KHÔNG ghi đè: đó có thể
 * là bên vận hành sửa tay sau khi biết tình hình thực tế, máy không được đè lên
 * quyết định của người. (Còn khi nhân viên tự bấm chọn trên UI thì ghi đè — đó là
 * thao tác có chủ ý của con người.)
 */
export async function dongBoCourierLark(
  donDaChon: Array<{ soDon: string | null; carrierKey: string }>,
  docRecords: () => Promise<Array<{ record_id: string; fields: Record<string, unknown> }>>,
  ghi: (recordId: string, fields: Record<string, unknown>) => Promise<void>,
): Promise<KetQuaDongBoCourier> {
  const kq: KetQuaDongBoCourier = { doiChieu: 0, daDien: 0, lechKhongGhi: [], loi: [] };
  const canGhi = new Map<string, string>();
  for (const d of donDaChon) {
    const ten = tenCourierLark(d.carrierKey);
    if (ten && d.soDon) canGhi.set(d.soDon.trim().replace(/^#/, ''), ten);
  }
  if (canGhi.size === 0) return kq;

  const recs = await docRecords();
  for (const r of recs) {
    const so = soDonTuRecord(r.fields);
    if (!so) continue;
    const ten = canGhi.get(so);
    if (!ten) continue;
    kq.doiChieu += 1;
    const hienTai = r.fields[COT_COURIER];
    if (hienTai === ten) continue;
    if (hienTai != null && String(hienTai).trim() !== '') {
      kq.lechKhongGhi.push({ soDon: so, tenTrenLark: String(hienTai), tenHeThong: ten });
      continue;
    }
    try { await ghi(r.record_id, { [COT_COURIER]: ten }); kq.daDien += 1; }
    catch (e) { kq.loi.push(`${so}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return kq;
}
