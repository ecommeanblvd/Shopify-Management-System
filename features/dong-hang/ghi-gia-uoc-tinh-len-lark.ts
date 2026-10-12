/**
 * Ghi giá ước tính của MỘT kiện lên dòng Lark của nó — cố ý KHÔNG nằm trong
 * `actions.ts` (Ruling của người điều phối, Task 5 "nhập tracking đẩy giá ước
 * tính lên Lark"): action nhập tracking gọi hàm này ngay sau khi lưu mã, NHƯNG
 * cron điền bù (Task 7) cũng phải chạy đúng các bước này cho kiện lỡ nhịp lần
 * đầu — mà cron chạy ngoài request, KHÔNG có session nên không qua được cổng
 * quyền (`auth.api.getSession`) của một server action. Tách hàm thường ở đây
 * để cả hai nơi gọi CHUNG một đường ghi — nhân bản logic ghi Lark lần thứ hai
 * là đúng thứ D-045 cấm (bài học cột `Couriers` ghi sai qua hai đường).
 *
 * KHÔNG tự kiểm quyền: caller (action hoặc cron) chịu trách nhiệm đó.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { layGiaUocTinh } from './lay-gia-uoc-tinh';
import { patchGiaUocTinh } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';
import { getLogRecordById, updateLogRecordFields } from '@/features/lark/client';

export interface KetQuaGhiGiaUocTinh {
  giaDaGhi: boolean;
  /** Lý do chưa ghi được — PHẢI nói ra cho người dùng/log, không im lặng coi như
   *  xong (Review Focus #2, Task 5). Vắng mặt khi `giaDaGhi: true`. */
  canhBao?: string;
}

/**
 * Thứ tự CỐ Ý: lấy giá TRƯỚC khi đòi `larkRecordId` — brief xếp "chưa lấy được
 * giá" (bước 3) trước "kiện chưa có dòng Lark" (bước 4), nên cảnh báo trả về
 * đúng theo thứ tự đó khi cả hai đều thiếu.
 *
 * KHÔNG ném lỗi ở mọi nhánh thất bại: tầng gọi (action nhập tracking) đã lưu
 * mã vận đơn xong trước khi gọi hàm này — mọi thứ từ đây là best-effort, kiện
 * vẫn phải coi là nhập tracking THÀNH CÔNG dù chưa ghi được giá lên Lark.
 */
export async function ghiGiaUocTinhLenLark(shipmentId: string): Promise<KetQuaGhiGiaUocTinh> {
  const gia = await layGiaUocTinh(shipmentId);
  if (!gia) {
    return { giaDaGhi: false, canhBao: 'chưa lấy được giá ước tính, cron sẽ thử lại' };
  }

  const [k] = await db.select({
    trackingNumber: schema.shipments.trackingNumber,
    larkRecordId: schema.shipments.larkRecordId,
  }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!k) return { giaDaGhi: false, canhBao: 'Không tìm thấy kiện.' };

  if (!k.larkRecordId) {
    return { giaDaGhi: false, canhBao: 'kiện chưa có dòng Lark tương ứng' };
  }

  try {
    const rec = await getLogRecordById(k.larkRecordId);
    if (!rec) {
      return { giaDaGhi: false, canhBao: 'dòng Lark của kiện không còn (đã bị xoá bên Lark)' };
    }

    const patch = patchGiaUocTinh(gia, rec.fields, k.trackingNumber);
    if (Object.keys(patch).length > 0) {
      await updateLogRecordFields(k.larkRecordId, patch);
    }

    /* Đóng dấu NGAY CẢ KHI patch rỗng (mọi ô đích đã có số từ trước): "đã xử lý
     * xong vòng này" khác với "có ghi gì mới" — thiếu dấu ở nhánh patch rỗng thì
     * cron vẫn gọi lại Lark mãi mãi cho một kiện vốn chẳng còn ô trống nào để
     * điền (Ruling 2, người điều phối). */
    await db.update(schema.shipments)
      .set({ giaUocTinhGhiLuc: new Date() })
      .where(eq(schema.shipments.id, shipmentId));

    return { giaDaGhi: true };
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark lỗi:', e);
    return { giaDaGhi: false, canhBao: 'ghi giá lên Lark thất bại, cron sẽ thử lại' };
  }
}
