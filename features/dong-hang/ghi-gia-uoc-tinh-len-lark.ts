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
  /** Lý do chưa ghi được, hoặc cảnh báo phụ dù đã ghi (vd đóng dấu thất bại) — PHẢI
   *  nói ra cho người dùng/log, không im lặng coi như xong (Review Focus #2, Task 5). */
  canhBao?: string;
}

/**
 * Đóng dấu `gia_uoc_tinh_ghi_luc = now()` — TÁCH RIÊNG khỏi try/catch của lệnh ghi
 * Lark (I2, review coordinator): ca thực tế nhất là deploy trước khi migration 0204
 * được áp tay (cột chưa tồn tại trên CSDL) → lệnh UPDATE này hỏng, nhưng Lark THẬT
 * SỰ ĐÃ GHI RỒI ở bước trước. Gộp chung một try sẽ báo sai thành "ghi giá lên Lark
 * thất bại" trong khi Lark không hề thất bại — gây hiểu lầm khi debug và có thể
 * khiến người xử lý thử ghi lại một thao tác đã xong.
 */
async function dongDauGhiLuc(shipmentId: string): Promise<boolean> {
  try {
    await db.update(schema.shipments)
      .set({ giaUocTinhGhiLuc: new Date() })
      .where(eq(schema.shipments.id, shipmentId));
    return true;
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark: đóng dấu gia_uoc_tinh_ghi_luc lỗi:', e);
    return false;
  }
}

/**
 * Thứ tự CỐ Ý: lấy giá TRƯỚC khi đòi `larkRecordId` — brief xếp "chưa lấy được
 * giá" (bước 3) trước "kiện chưa có dòng Lark" (bước 4), nên cảnh báo trả về
 * đúng theo thứ tự đó khi cả hai đều thiếu.
 *
 * KHÔNG ném lỗi ở MỌI nhánh: toàn thân hàm nằm trong một `try` (sửa theo review —
 * bản trước chỉ bọc từ `getLogRecordById` xuống, để `db.select` phía trên ngoài
 * try; DB trục trặc đúng dòng đó sẽ ném ra ngoài, và caller (`actions.ts`) gọi trần
 * không bọc, nên action đổ lỗi đỏ dù mã vận đơn ĐÃ lưu xong trước khi gọi hàm này).
 * Tầng gọi (action nhập tracking) đã lưu mã vận đơn xong trước khi gọi hàm này —
 * mọi thứ từ đây là best-effort, kiện vẫn phải coi là nhập tracking THÀNH CÔNG dù
 * chưa ghi được giá lên Lark.
 */
export async function ghiGiaUocTinhLenLark(shipmentId: string): Promise<KetQuaGhiGiaUocTinh> {
  try {
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

    const rec = await getLogRecordById(k.larkRecordId);
    if (!rec) {
      /* I3 (phán quyết coordinator): dòng Lark đã bị XOÁ sẽ không tự quay lại —
       * thử lại vô hạn chỉ đốt tiền gọi API báo giá mà không bao giờ thành công.
       * VẪN đóng dấu ở nhánh này để cron (Task 7) không bốc lại kiện này mãi
       * mãi; muốn chạy lại thì xoá dấu `gia_uoc_tinh_ghi_luc` là đủ. */
      const dongDauOk = await dongDauGhiLuc(shipmentId);
      return {
        giaDaGhi: false,
        canhBao: dongDauOk
          ? 'dòng Lark của kiện không còn tồn tại (đã bị xoá bên Lark) — đã đóng dấu để không tự thử lại; xoá dấu nếu cần chạy lại'
          : 'dòng Lark của kiện không còn tồn tại (đã bị xoá bên Lark); đóng dấu cũng thất bại nên cron sẽ còn gọi lại',
      };
    }

    const patch = patchGiaUocTinh(gia, rec.fields, k.trackingNumber);
    if (Object.keys(patch).length > 0) {
      await updateLogRecordFields(k.larkRecordId, patch);
    }

    /* Đóng dấu NGAY CẢ KHI patch rỗng (mọi ô đích đã có số từ trước): "đã xử lý
     * xong vòng này" khác với "có ghi gì mới" — thiếu dấu ở nhánh patch rỗng thì
     * cron vẫn gọi lại Lark mãi mãi cho một kiện vốn chẳng còn ô trống nào để
     * điền (Ruling 2, người điều phối). */
    const dongDauOk = await dongDauGhiLuc(shipmentId);
    if (!dongDauOk) {
      // Lark ĐÃ ghi xong (hoặc không cần ghi gì) — chỉ riêng dấu thất bại. Vẫn
      // là THÀNH CÔNG, kèm cảnh báo phụ (I2).
      return {
        giaDaGhi: true,
        canhBao: 'đã ghi giá lên Lark, nhưng đóng dấu thất bại — cron có thể gọi lại Lark thêm một lượt (vô hại: ô đích đã có số nên không ghi đè gì mới)',
      };
    }

    return { giaDaGhi: true };
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark lỗi:', e);
    return { giaDaGhi: false, canhBao: 'ghi giá lên Lark thất bại, cron sẽ thử lại' };
  }
}
