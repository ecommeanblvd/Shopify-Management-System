/**
 * THUẦN: chọn cân + kích thước giữa số gõ trong SMS và số Lark đồng bộ, dùng để tính GIÁ ƯỚC
 * TÍNH (`lay-gia-uoc-tinh.ts`). Không I/O.
 *
 * Vì sao luật khác `nguonCanKien` (`van-don.ts:100`): hộp thoại Lên vận đơn chọn NGUYÊN KHỐI
 * — SMS có bước Đóng thùng thì lấy hết cân+dim của SMS, không có thì lấy hết của Lark, không
 * trộn giữa hai bên. Ở đây mục tiêu khác: giá phải tính được NGAY lúc nhân sự vừa gõ cân, dù
 * Lark chưa đồng bộ kích thước (hoặc ngược lại) — nên mỗi Ô (cân/dài/rộng/cao) chọn nguồn ĐỘC
 * LẬP, SMS thắng Lark trên từng ô. `nguon` báo theo bên đang CÓ ĐÓNG GÓP gì đó (SMS có ít nhất
 * một ô thì 'sms', không thì rơi về 'lark' nếu Lark có ô nào, không thì null) — không tách
 * nguồn theo từng ô vì không ai cần biết "cân là của SMS, dài là của Lark" ở mức hiển thị giá.
 *
 * Hai luật đang SONG SONG tồn tại trong repo (chọn nguyên khối vs chọn theo ô) — xem báo cáo
 * Task 8 (`task-8-report.md`) để CEO quyết có cần gộp về một luật hay không.
 */

export interface CanDimMoi {
  canKg: string | null;
  daiCm: string | null;
  rongCm: string | null;
  caoCm: string | null;
}

export interface CanDim {
  canKg: number | null;
  daiCm: number | null;
  rongCm: number | null;
  caoCm: number | null;
  nguon: 'sms' | 'lark' | null;
}

/**
 * Cột `numeric` của Postgres qua Drizzle về là STRING, không phải number.
 *
 * `''` = chưa gõ gì → coi như vắng (null). `'0'` = một số 0 THẬT đã gõ (kích thước 0 là dữ
 * liệu sai, nhưng vẫn là có gõ — không phải vắng) → PHẢI giữ là 0, không rơi về bên kia.
 */
const so = (v: string | null): number | null => (v == null || v.trim() === '' ? null : Number(v));

/** Bên này có đóng góp gì không — ít nhất một trong bốn ô có số. */
const coO = (m: CanDimMoi): boolean => (
  so(m.canKg) != null || so(m.daiCm) != null || so(m.rongCm) != null || so(m.caoCm) != null
);

export function nguonCanDim(sms: CanDimMoi, lark: CanDimMoi): CanDim {
  const nguon: 'sms' | 'lark' | null = coO(sms) ? 'sms' : coO(lark) ? 'lark' : null;
  return {
    // Mỗi ô độc lập: ô SMS trống thì lấy đúng ô đó từ Lark — không kéo cả record như
    // `nguonCanKien`. Cao thiếu ở cả hai bên vẫn là null (KHÔNG BAO GIỜ thay bằng 0): cao null
    // là dấu hiệu chọn giá Pak thay Package ở bước sau, không phải lỗi cần vá bằng số 0.
    canKg: so(sms.canKg) ?? so(lark.canKg),
    daiCm: so(sms.daiCm) ?? so(lark.daiCm),
    rongCm: so(sms.rongCm) ?? so(lark.rongCm),
    caoCm: so(sms.caoCm) ?? so(lark.caoCm),
    nguon,
  };
}
