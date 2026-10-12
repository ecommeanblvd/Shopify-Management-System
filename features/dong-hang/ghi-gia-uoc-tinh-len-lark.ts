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
import { and, eq, isNull } from 'drizzle-orm';
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
 * GIÀNH VIỆC bằng chính dấu `gia_uoc_tinh_ghi_luc`: đóng dấu NGAY TỪ ĐẦU, và chỉ
 * khi dấu còn trống (`UPDATE … WHERE … IS NULL RETURNING` — mẫu claim của
 * `features/packing/push-fulfillment.ts:14-22`). `false` = kiện này đã có người
 * khác giành, hoặc đã xử lý xong.
 *
 * Vì sao phải giành TRƯỚC khi làm việc: dấu đóng ở CUỐI thì trong cửa sổ vài giây
 * của 1 lượt Rate API + 2 lượt Lark, kiện vẫn thoả `canDienBu` ⇒ cron bắt đúng nó
 * ⇒ hai bên cùng thấy ô Lark trống ⇒ bên sau ghi lên ô mà bên trước vừa điền. Hai
 * lượt cron chồng nhau cũng vậy. Lark chỉ cho điền thêm, không có undo.
 *
 * Lệnh này hỏng (ca thực tế nhất: deploy trước khi migration 0204 được áp tay nên
 * cột chưa tồn tại) ⇒ coi như KHÔNG giành được ⇒ KHÔNG ghi gì lên Lark. Fail-closed
 * có chủ ý: không có dấu thì không có cách nào chặn lượt thứ hai ghi trùng.
 */
async function giuViecGhiGia(shipmentId: string): Promise<boolean> {
  try {
    const giu = await db.update(schema.shipments)
      .set({ giaUocTinhGhiLuc: new Date() })
      .where(and(eq(schema.shipments.id, shipmentId), isNull(schema.shipments.giaUocTinhGhiLuc)))
      .returning({ id: schema.shipments.id });
    return giu.length > 0;
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark: giành việc (gia_uoc_tinh_ghi_luc) lỗi:', e);
    return false;
  }
}

/**
 * NHẢ việc đã giành: xoá dấu để lượt sau (cron) còn thử lại được.
 *
 * Chỉ nhả ở những nhánh CÒN CÓ THỂ THỬ LẠI (chưa lấy được giá, kiện chưa có dòng Lark, lỗi
 * mạng/Lark). KHÔNG nhả khi đã ghi xong, và KHÔNG nhả khi biết chắc sẽ không bao giờ ghi được
 * (dòng Lark đã bị xoá) — hai ca đó dấu phải giữ, nếu không cron gọi lại mãi mãi.
 *
 * Nhả thất bại thì kiện mang dấu mà chưa ghi gì: cron sẽ bỏ qua nó. Chấp nhận có chủ ý —
 * hướng an toàn là KHÔNG ghi, và cách chữa đã có sẵn (xoá dấu rồi chạy lại).
 */
async function nhaViecGhiGia(shipmentId: string): Promise<void> {
  try {
    await db.update(schema.shipments)
      .set({ giaUocTinhGhiLuc: null })
      .where(eq(schema.shipments.id, shipmentId));
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark: nhả việc (gia_uoc_tinh_ghi_luc) lỗi:', e);
  }
}

/**
 * Thứ tự CỐ Ý: GIÀNH VIỆC trước (xem `giuViecGhiGia`), rồi lấy giá, rồi mới đòi
 * `larkRecordId` — brief xếp "chưa lấy được giá" (bước 3) trước "kiện chưa có dòng
 * Lark" (bước 4), nên cảnh báo trả về đúng theo thứ tự đó khi cả hai đều thiếu.
 * Giành việc xếp trước cả hai vì nó là thứ RẺ NHẤT (một UPDATE) và vì mục đích của
 * nó là chặn lượt thứ hai TRƯỚC khi lượt đó kịp gọi API báo giá.
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
  if (!await giuViecGhiGia(shipmentId)) {
    return {
      giaDaGhi: false,
      canhBao: 'kiện này đã được ghi giá, hoặc đang có một lượt khác xử lý — không ghi chồng (nếu dấu gia_uoc_tinh_ghi_luc chưa tồn tại trên CSDL thì áp migration 0204 trước)',
    };
  }

  try {
    const gia = await layGiaUocTinh(shipmentId);
    if (!gia) {
      await nhaViecGhiGia(shipmentId);
      return { giaDaGhi: false, canhBao: 'chưa lấy được giá ước tính, cron sẽ thử lại' };
    }
    /* I8: `maLa` là khoản tiền THẬT của hãng mà hình chung không có cột để đựng (vd mã UPS
     * '110'/'190'). Nó vừa rơi khỏi khối ô thành phần, vừa rơi khỏi gốc tính VAT, nhưng VẪN
     * nằm trong ô Tổng — không nói ra thì không ai biết vì sao tổng ≠ cộng các ô. Khử trùng
     * bằng Set: một mã xuất hiện nhiều dòng chỉ cần kể một lần. */
    const maLa = [...new Set(gia.maLa)];

    const [k] = await db.select({
      trackingNumber: schema.shipments.trackingNumber,
      larkRecordId: schema.shipments.larkRecordId,
    }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
    if (!k) {
      await nhaViecGhiGia(shipmentId);
      return { giaDaGhi: false, canhBao: 'Không tìm thấy kiện.' };
    }

    if (!k.larkRecordId) {
      await nhaViecGhiGia(shipmentId);
      return { giaDaGhi: false, canhBao: 'kiện chưa có dòng Lark tương ứng' };
    }

    const rec = await getLogRecordById(k.larkRecordId);
    if (!rec) {
      /* I3 (phán quyết coordinator): dòng Lark đã bị XOÁ sẽ không tự quay lại —
       * thử lại vô hạn chỉ đốt tiền gọi API báo giá mà không bao giờ thành công.
       * GIỮ dấu ở nhánh này (không nhả) để cron (Task 7) không bốc lại kiện này
       * mãi mãi; muốn chạy lại thì xoá dấu `gia_uoc_tinh_ghi_luc` là đủ. */
      return {
        giaDaGhi: false,
        canhBao: 'dòng Lark của kiện không còn tồn tại (đã bị xoá bên Lark) — đã đóng dấu để không tự thử lại; xoá dấu nếu cần chạy lại',
      };
    }

    const { patch, canhBao } = patchGiaUocTinh(gia, rec.fields, k.trackingNumber);
    if (Object.keys(patch).length > 0) {
      try {
        await updateLogRecordFields(k.larkRecordId, patch);
      } catch (e) {
        /* Nêu NGUYÊN VĂN lỗi Lark (đã mang `code=`/`msg=`) kèm tên cột đã gửi: PUT của Lark
         * là all-or-nothing, nên một cột bị đổi tên bên Lark chặn cả bản vá — không có mã
         * lỗi và tên cột thì người xử lý không biết bắt đầu từ đâu. */
        await nhaViecGhiGia(shipmentId);
        return {
          giaDaGhi: false,
          canhBao: `Lark từ chối bản vá (${e instanceof Error ? e.message : String(e)}); cột đã gửi: ${Object.keys(patch).join(', ')}`,
        };
      }
    }

    /* GIỮ dấu NGAY CẢ KHI patch rỗng (mọi ô đích đã có số từ trước): "đã xử lý
     * xong vòng này" khác với "có ghi gì mới" — nhả dấu ở nhánh patch rỗng thì
     * cron vẫn gọi lại Lark mãi mãi cho một kiện vốn chẳng còn ô trống nào để
     * điền (Ruling 2, người điều phối). */
    const loiNhan = [
      ...canhBao,
      ...(maLa.length > 0
        ? [`khoản hãng chưa có cột để đựng: ${maLa.join(', ')} — nằm trong ô Tổng nhưng không nằm ở ô thành phần nào, kiểm lại bằng mắt`]
        : []),
    ];
    return loiNhan.length > 0 ? { giaDaGhi: true, canhBao: loiNhan.join(' · ') } : { giaDaGhi: true };
  } catch (e) {
    console.error('[dong-hang] ghiGiaUocTinhLenLark lỗi:', e);
    await nhaViecGhiGia(shipmentId);
    return { giaDaGhi: false, canhBao: 'ghi giá lên Lark thất bại, cron sẽ thử lại' };
  }
}
