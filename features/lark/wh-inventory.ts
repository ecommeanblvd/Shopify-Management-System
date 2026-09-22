/**
 * Ghi việc nhận + kiểm hàng của kho sang bảng Lark "WH - Inventory".
 *
 * Đường ghi HẸP có chủ đích: chỉ tạo dòng và sửa đúng những cột ở gia-tri-lark.ts, KHÔNG có
 * hàm xoá — một lỗi lập trình không được phép quét sạch bảng vận hành của kho (D-045).
 */
import { searchWhInventoryByDon, createWhInventoryRecord, updateWhInventoryRecord, type LarkRecord } from './client';
import { cotTaoDong, cotCapNhat, type ViecNhanKcs } from '@/features/kho-nhan/gia-tri-lark';

/** THUẦN: trong các dòng kho của một ĐƠN, dòng nào nối tới đúng món này. */
export function locDongTheoMon(recs: readonly LarkRecord[], monRecordId: string): string | null {
  for (const r of recs) {
    const v = r.fields['Import (select order)'] as { link_record_ids?: unknown } | undefined;
    const ids = Array.isArray(v?.link_record_ids) ? (v!.link_record_ids as unknown[]) : [];
    if (ids.some((x) => x === monRecordId)) return r.record_id;
  }
  return null;
}

/**
 * Tạo dòng mới hoặc cập nhật dòng có sẵn của món. Tìm theo LIÊN KẾT MÓN (không theo mã đơn —
 * một đơn có nhiều món).
 *
 * Tìm rồi tạo là HAI lượt gọi mạng, tự nó không chống được chạy đua. Chỗ chặn thật nằm ở SMS:
 * bảng wh_nhan_kcs có unique index theo món, nên hai người cùng nhận một món vẫn chỉ ra một
 * dòng việc và một lần đẩy sang đây.
 */
export async function ghiDongKho(v: ViecNhanKcs, ngay: Date = new Date()): Promise<{ larkRecordId: string; tao: boolean }> {
  const dsDon = await searchWhInventoryByDon(v.orderNumber);
  const daCo = v.monRecordId ? locDongTheoMon(dsDon, v.monRecordId) : null;
  if (daCo) {
    await updateWhInventoryRecord(daCo, cotCapNhat(v));
    return { larkRecordId: daCo, tao: false };
  }
  const id = await createWhInventoryRecord(cotTaoDong(v, ngay));
  return { larkRecordId: id, tao: true };
}
