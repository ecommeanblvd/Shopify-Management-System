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
import { dangGhi, tenTrigger, type TrangThaiBang } from './trang-thai-ghi';

/**
 * Trạng thái ghi của từng bảng, giữ đúng thứ tự người gọi đưa vào.
 *
 * `NOT tgisinternal` để bỏ trigger ràng buộc khoá ngoại do Postgres tự tạo. Ghép theo TÊN
 * TRIGGER (`nhat_ky_<bang>`) chứ không theo tên bảng: một bảng thường có nhiều trigger, và
 * thứ cần biết là trigger CỦA NHẬT KÝ có đó và có đang bật hay không.
 */
export async function trangThaiGhiCua(bang: readonly string[]): Promise<TrangThaiBang[]> {
  if (bang.length === 0) return [];
  const ten = bang.map(tenTrigger);
  const r = await db.execute<{ tgname: string; tgenabled: string }>(sql`
    SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal
       AND n.nspname = 'public'
       AND t.tgname IN (${sql.join(ten.map((x) => sql`${x}`), sql`, `)})`);
  const theoTen = new Map(r.rows.map((x) => [x.tgname, x.tgenabled]));
  return bang.map((b) => ({
    bang: b,
    nhan: nhanBang(b),
    daGhi: dangGhi(theoTen.get(tenTrigger(b))),
  }));
}
