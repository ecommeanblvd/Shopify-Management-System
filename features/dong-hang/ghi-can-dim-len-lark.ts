/**
 * Ghi cân + kích thước đóng thùng của MỘT kiện lên dòng Lark của nó (Task 9, spec 2026-10-14
 * §3b.3). Theo đúng khuôn `ghi-gia-uoc-tinh-len-lark.ts`: đọc kiện + `larkRecordId`, đọc record
 * Lark hiện tại, dựng patch THUẦN (`xemTruocGhiCanDim`), gửi, rồi ghi lại BIÊN NHẬN giá trị vừa
 * gửi để lượt sau còn biết mình được phép đè cột nào (xem `patch-can-dim.ts` để biết vì sao là
 * biên nhận GIÁ TRỊ, không phải danh sách tên cột — vòng sửa sau review 14/10/2026).
 *
 * KHÔNG tự kiểm quyền: caller (`ghiDongThung` trong `actions.ts`) chịu trách nhiệm đó, và PHẢI
 * gọi hàm này NGOÀI transaction lưu đóng thùng, trong try/catch riêng — Lark hỏng không được
 * chặn việc lưu, vì người đóng hàng đang cầm kiện trên tay và cần lưu được ngay.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { xemTruocGhiCanDim } from '@/features/lark/ghi-nguoc/patch-can-dim';
import { getLogRecordById, updateLogRecordFields } from '@/features/lark/client';

export interface KetQuaGhiCanDim {
  daGhi: boolean;
  /** Lý do chưa ghi được, hoặc cảnh báo phụ dù đã ghi (ô người khác gõ, bỏ qua) — PHẢI nói
   *  ra cho toast/log, không im lặng coi như xong. */
  canhBao?: string;
}

/** Đọc cột `numeric` của Drizzle (trả CHUỖI hoặc `null`) ra số. `Number('')`/`Number(chuỗi
 *  hỏng)` ra `NaN`, mà `NaN != null` là `true` — không chặn thì `NaN` lọt vào patch,
 *  `JSON.stringify(NaN)` ra `null`, và Lark có thể từ chối CẢ bản vá hoặc xoá trắng ô. Chặn
 *  bằng `Number.isFinite` để một cột dữ liệu hỏng chỉ mất đúng ô đó, không mất cả lượt ghi. */
const so = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Biên nhận hiện có trên CSDL — object khoá=tên cột, giá trị=đã gửi lần trước. Cột `jsonb`
 *  không gắn `$type` ở `schema.ts` nên Drizzle trả `unknown`; dữ liệu lịch sử từ 0208 (trước
 *  vòng sửa) có thể còn là MẢNG — coi mảng đó như "chưa có biên nhận nào" (object rỗng) thay
 *  vì ép kiểu sai, vì mảng tên cột không mang giá trị để so. */
function bienNhanHienCo(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * KHÔNG ném lỗi ở MỌI nhánh: toàn thân hàm nằm trong một `try`. Tầng gọi (`ghiDongThung`) đã
 * lưu cân/dim vào CSDL SMS xong trước khi gọi hàm này — mọi thứ từ đây là best-effort, kiện
 * vẫn phải coi là đóng thùng THÀNH CÔNG dù chưa ghi được lên Lark.
 */
export async function ghiCanDimLenLark(shipmentId: string): Promise<KetQuaGhiCanDim> {
  try {
    const [k] = await db.select({
      canKg: schema.shipments.smsWeightKg,
      daiCm: schema.shipments.smsDimLengthCm,
      rongCm: schema.shipments.smsDimWidthCm,
      caoCm: schema.shipments.smsDimHeightCm,
      larkRecordId: schema.shipments.larkRecordId,
      oLarkDoSmsGhi: schema.shipments.oLarkDoSmsGhi,
    }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
    if (!k) return { daGhi: false, canhBao: 'Không tìm thấy kiện.' };

    if (!k.larkRecordId) {
      return { daGhi: false, canhBao: 'kiện chưa có dòng Lark tương ứng' };
    }

    const rec = await getLogRecordById(k.larkRecordId);
    if (!rec) {
      return {
        daGhi: false,
        canhBao: 'dòng Lark của kiện không còn tồn tại (đã bị xoá bên Lark)',
      };
    }

    const bienNhan = bienNhanHienCo(k.oLarkDoSmsGhi);
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: so(k.canKg), daiCm: so(k.daiCm), rongCm: so(k.rongCm), caoCm: so(k.caoCm) },
      rec.fields,
      bienNhan,
    );

    const cotDaGui = Object.keys(patch);
    if (cotDaGui.length > 0) {
      try {
        await updateLogRecordFields(k.larkRecordId, patch);
      } catch (e) {
        /* Nêu NGUYÊN VĂN lỗi Lark kèm tên cột đã gửi: PUT của Lark là all-or-nothing, một cột
         * bị đổi tên bên Lark chặn cả bản vá — không có mã lỗi và tên cột thì người xử lý
         * không biết bắt đầu từ đâu. */
        return {
          daGhi: false,
          canhBao: `Lark từ chối bản vá (${e instanceof Error ? e.message : String(e)}); cột đã gửi: ${cotDaGui.join(', ')}`,
        };
      }

      /* Ghi lại BIÊN NHẬN giá trị vừa gửi — GHI ĐÈ đúng những cột vừa gửi (giá trị MỚI thắng),
       * giữ nguyên biên nhận của những cột KHÔNG nằm trong lượt này (một kiện có thể được ghi
       * nhiều lượt, mỗi lượt chỉ một trong hai cột trống/khớp). Lỗi ở bước này KHÔNG coi là
       * ghi Lark thất bại: patch đã lên Lark thật rồi, chỉ có sổ biên nhận chưa cập nhật — nói
       * ra bằng cảnh báo để người đọc log biết lượt sau có thể bị từ chối đè nhầm. */
      const bienNhanMoi = { ...bienNhan, ...patch };
      try {
        await db.update(schema.shipments)
          .set({ oLarkDoSmsGhi: bienNhanMoi })
          .where(eq(schema.shipments.id, shipmentId));
      } catch (e) {
        console.error('[dong-hang] ghiCanDimLenLark: ghi o_lark_do_sms_ghi lỗi:', e);
        canhBao.push('đã ghi lên Lark nhưng chưa lưu được biên nhận — lượt sau có thể bị coi là ô người khác gõ');
      }
    }

    return canhBao.length > 0 ? { daGhi: true, canhBao: canhBao.join(' · ') } : { daGhi: true };
  } catch (e) {
    console.error('[dong-hang] ghiCanDimLenLark lỗi:', e);
    return { daGhi: false, canhBao: 'ghi cân/kích thước lên Lark thất bại' };
  }
}
