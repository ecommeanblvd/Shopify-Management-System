/**
 * Tra `pg_trigger`: bảng nào ĐANG thật sự ghi nhật ký.
 *
 * Phải TRA, không được đoán. Trigger bật/gỡ bằng `scripts/nhat-ky-bat-tat.ts` (cố ý không
 * nằm trong tệp di trú), nên không có chỗ nào trong mã nói được trạng thái thật — mà màn
 * hình thì phải nói dứt khoát "chưa bật" hay "đã bật, chưa có thay đổi nào" (xem
 * `trang-thai-ghi.ts`: nhập nhằng hai chuyện đó là đúng lỗi cả tính năng này dựng để tránh).
 *
 * Tệp RIÊNG, KHÔNG phải `'use server'`: cả panel (`doc-panel.ts`) và trang `/f/nhat-ky` đều
 * cần hàm này, mà để nó trong một tệp `'use server'` là mỗi export thành một điểm vào công
 * khai — kể cả hàm này, vốn không có hàng rào quyền nào của riêng nó.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { nhanBang } from '@/components/nhat-ky/bo-loc';
import type { Tx } from './ghi-voi';
import { dangGhi, tenTrigger, type TrangThaiBang } from './trang-thai-ghi';

/** `db`, hoặc một giao dịch ĐANG MỞ — cùng kiểu mà `queries.ts` dùng, và cùng lý do. */
type NguonDoc = typeof db | Tx;

/**
 * Trạng thái ghi của từng bảng, giữ đúng thứ tự người gọi đưa vào.
 *
 * Lọc theo CẶP `(tên bảng, tên trigger)`, không chỉ theo tên trigger. Tên trigger trong
 * Postgres chỉ unique THEO TỪNG BẢNG, nên `nhat_ky_shipments` đặt trên một bảng khác là
 * chuyện hoàn toàn hợp lệ — mà chỉ khớp tên trigger thì dòng đó cũng vào kết quả và màn
 * hình báo "đã bật" cho `shipments` trong khi `shipments` chưa bật gì. Đó đúng là kiểu nói
 * sai mà cả tính năng nhật ký dựng ra để tránh, nên điều kiện phải là cặp: `IN ((a,b), …)`
 * so cả hai cột một lượt, không có cách nào khớp lệch một nửa.
 *
 * `NOT tgisinternal` để bỏ trigger ràng buộc khoá ngoại do Postgres tự tạo.
 *
 * `nguon` nhận một giao dịch đang mở để `scripts/nhat-ky-kiem-tra-trigger.ts` chạy được
 * ĐÚNG câu này trên một trigger mồi tạo trong `BEGIN … ROLLBACK` — `vitest` không chạm
 * được CSDL, nên đó là cách duy nhất chứng minh điều kiện cặp `(bảng, trigger)` thật sự
 * loại được trigger trùng tên ở bảng khác. Một câu viết lại cho script thì lượt kiểm đi
 * kiểm chính nó, còn câu màn hình dùng thật không ai chạm tới.
 */
export async function trangThaiGhiCua(
  bang: readonly string[],
  nguon: NguonDoc = db,
): Promise<TrangThaiBang[]> {
  if (bang.length === 0) return [];
  const cap = bang.map((b) => sql`(${b}, ${tenTrigger(b)})`);
  const r = await nguon.execute<{ relname: string; tgenabled: string }>(sql`
    SELECT c.relname, t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal
       AND n.nspname = 'public'
       AND (c.relname, t.tgname) IN (${sql.join(cap, sql`, `)})`);
  const theoBang = new Map(r.rows.map((x) => [x.relname, x.tgenabled]));
  return bang.map((b) => ({
    bang: b,
    nhan: nhanBang(b),
    daGhi: dangGhi(theoBang.get(b)),
  }));
}
