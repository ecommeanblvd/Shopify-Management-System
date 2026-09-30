/**
 * Đọc ảnh LỖI QC của từng chiếc, để hiện thành cột trên bảng "Nhận hôm nay" (CEO 30/09/2026).
 *
 * CỐ Ý KHÔNG có `'use server'`: hàm chạy phía máy chủ dùng chung, không phải endpoint cho
 * trình duyệt gọi — cùng lý do đã ghi ở `anh-lark.ts`.
 *
 * Ảnh nằm ở `wh_loi_qc`: MỘT DÒNG MỘT CHỖ LỖI, mỗi dòng một ảnh. Bẩn gấu VÀ rách nách VÀ hỏng
 * khoá là ba dòng — nhồi vào một ô là mất bằng chứng khi cãi với brand.
 *
 * Đọc CẢ LÔ trong một lượt truy vấn, không hỏi từng chiếc: bảng hiện tới 200 dòng, hỏi từng
 * dòng là 200 lượt đi CSDL cho một lần mở màn.
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl } from '@/lib/storage/s3';
import { NHAN_LY_DO, type LyDoLoi } from './loi-qc';

export interface AnhLoiQc {
  id: string;
  itemId: string;
  lyDo: LyDoLoi;
  nhanLyDo: string;
  ghiChu: string | null;
  /** Link ký hạn ngắn; null khi chưa cấu hình kho ảnh hoặc ký hỏng. */
  url: string | null;
}

/** Map itemId → các chỗ lỗi CÓ ẢNH. Chiếc không lỗi thì không có khoá trong map. */
export async function anhLoiQcTheoChiec(itemIds: readonly string[]): Promise<Record<string, AnhLoiQc[]>> {
  if (itemIds.length === 0) return {};
  const dong = await db.select({
    id: schema.whLoiQc.id, itemId: schema.whLoiQc.receiptItemId,
    lyDo: schema.whLoiQc.lyDo, anhKey: schema.whLoiQc.anhKey, ghiChu: schema.whLoiQc.ghiChu,
  }).from(schema.whLoiQc).where(inArray(schema.whLoiQc.receiptItemId, [...itemIds]));

  const ra: Record<string, AnhLoiQc[]> = {};
  for (const d of dong) {
    if (!d.anhKey) continue;       // chỗ lỗi ghi bằng chữ, không có ảnh — không phải việc của cột này
    const lyDo = d.lyDo as LyDoLoi;
    (ra[d.itemId] ??= []).push({
      id: d.id, itemId: d.itemId, lyDo, nhanLyDo: NHAN_LY_DO[lyDo] ?? lyDo,
      ghiChu: d.ghiChu,
      // Ký hỏng thì trả null chứ KHÔNG bỏ cả dòng: người đọc vẫn cần biết CÓ một chỗ lỗi ở đây.
      url: await getSignedDownloadUrl(d.anhKey).catch(() => null),
    });
  }
  return ra;
}
