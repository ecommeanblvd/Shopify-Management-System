/**
 * Mở một giao dịch có GẮN DANH TÍNH, để trigger `nhat_ky_ghi()` biết ai vừa ghi.
 *
 * Trigger đọc danh tính bằng `current_setting('app.tac_nhan_id', true)` và
 * `current_setting('app.tac_nhan_nhan', true)`. Hàm này là chỗ DUY NHẤT đặt hai biến đó.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { idTacNhan, nhanTacNhan, type TacNhan } from './tac-nhan';

/** Tham số giao dịch của Drizzle — cùng kiểu `applyMovement` đang nhận. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Chạy `fn` trong MỘT giao dịch đã đặt sẵn danh tính `t`.
 *
 * ⚠ PHẢI là giao dịch, và PHẢI là `set_config(..., true)` — tham số thứ ba `true`
 * nghĩa là `SET LOCAL`, chết theo giao dịch. ĐỪNG "sửa cho gọn" thành mức phiên:
 *
 *  - `db/client.ts` dùng MỘT `Pool` của `pg`. Một lệnh `db.update(...)` trần mượn một
 *    kết nối trong pool chỉ cho đúng lệnh đó, rồi trả lại cho người sau.
 *  - Vì thế `SET LOCAL` chạy NGOÀI giao dịch không có tác dụng gì — nó chết ngay khi
 *    lệnh kết thúc, danh tính không tới được trigger.
 *  - Còn `set_config(..., false)` (mức phiên) thì sống dai trên kết nối đó: request sau
 *    mượn đúng kết nối ấy sẽ thừa hưởng danh tính của request trước. **Gán sai người
 *    còn tệ hơn không gán ai** — nó buộc tội nhầm một nhân sự, mà dòng nhật ký nhìn
 *    vẫn "đầy đủ" nên không ai nghi ngờ gì để đi kiểm.
 *
 * Đặt bằng THAM SỐ, không nối chuỗi: `userId` tới từ phiên đăng nhập, mà một chuỗi nối
 * vào câu `SET` là một lỗ tiêm SQL chạy dưới quyền của chính luồng ghi.
 *
 * Giao dịch nên BỌC HẸP — đúng những lệnh ghi cần gắn danh tính. Giao dịch dài là khoá
 * dài trên bảng kho đang chạy thật; đừng kéo lệnh gọi Lark hay `revalidatePath` vào trong.
 */
export async function ghiVoi<R>(t: TacNhan, fn: (tx: Tx) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.execute(cauDatDanhTinh(t));
    return fn(tx);
  });
}

/**
 * Câu SQL đặt danh tính — tách riêng và THUẦN để `ghi-voi.test.ts` ghim được hai điều mà
 * chú thích ở trên không ghim nổi: tham số thứ ba của **cả hai** lời gọi `set_config` là
 * `true`, và giá trị đi qua **tham số** chứ không nối vào chuỗi.
 *
 * Chú thích không đỏ khi ai đó sửa `true` thành `false`; test thì đỏ. Đây là hàng rào thật
 * cho cái bẫy "sửa cho gọn" nói ở trên.
 *
 * Một câu cho cả hai biến, bớt được một vòng tới CSDL. Rỗng → trigger `nullif(…, '')` biến
 * thành NULL: người thì không có nhãn máy, máy thì không có id người.
 */
export function cauDatDanhTinh(t: TacNhan): SQL {
  return sql`SELECT set_config('app.tac_nhan_id', ${idTacNhan(t)}, true), set_config('app.tac_nhan_nhan', ${nhanTacNhan(t)}, true)`;
}
