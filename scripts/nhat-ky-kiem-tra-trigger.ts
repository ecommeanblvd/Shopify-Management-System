/**
 * Chứng minh `trangThaiGhiCua` KHÔNG nhận trigger trùng tên ở bảng khác.
 *
 *   tsx scripts/nhat-ky-kiem-tra-trigger.ts
 *
 * VÌ SAO có tệp này: tên trigger trong Postgres chỉ unique THEO TỪNG BẢNG, nên một trigger
 * tên `nhat_ky_shipments` nằm trên một bảng khác là hợp lệ. Câu tra mà chỉ khớp `t.tgname`
 * sẽ đếm dòng đó và màn hình báo "Đã bật ghi nhật ký" cho `shipments` trong khi `shipments`
 * chưa bật gì — tức là nói sai đúng theo cái kiểu mà cả tính năng nhật ký dựng ra để tránh.
 * Điều kiện cặp `(c.relname, t.tgname)` chặn chuyện đó, nhưng `vitest` không chạm được CSDL
 * nên không có test nào chạy được câu SQL thật. Tệp này chạy nó.
 *
 * Mồi là một bảng MỚI tạo trong giao dịch, không phải một bảng đang sống: `CREATE TRIGGER`
 * lấy khoá ACCESS EXCLUSIVE trên bảng nó gắn vào, nên gắn mồi lên `goods_receipts` là chặn
 * lệnh ghi của kho trong lúc kiểm. Bảng mới thì không ai đang dùng.
 *
 * ⚠ KHÔNG CÓ `--ap-dung`, cố ý: tệp này LUÔN kết thúc bằng `ROLLBACK` (`DATABASE_URL` trỏ
 * production). Rollback cưỡng chế bằng `tx.rollback()`, và kiểm lại SAU khi giao dịch đóng
 * rằng bảng mồi không còn tồn tại.
 */
import { sql } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { db } from '@/db/client';
import { trangThaiGhiCua } from '@/features/nhat-ky/tra-trigger';
import { tenTrigger } from '@/features/nhat-ky/trang-thai-ghi';

/** Bảng mồi, tên có tiền tố rõ là tạm để không ai nhìn thấy trong `\dt` mà tưởng là thật. */
const BANG_MOI = 'nhat_ky_kiem_tra_tam';
/** Bảng THẬT bị mạo danh: chưa bật trigger (20/10/2026), nên "đã bật" là sai rõ ràng. */
const BANG_THAT = 'shipments';

let loi = 0;
function canh(dieuKien: boolean, cau: string): void {
  console.log(`${dieuKien ? '  OK  ' : ' SAI  '} ${cau}`);
  if (!dieuKien) loi += 1;
}

async function main(): Promise<void> {
  const truoc = await trangThaiGhiCua([BANG_THAT]);
  canh(truoc[0]?.daGhi === false, `${BANG_THAT} chưa bật trigger (tiền đề của lượt kiểm)`);
  if (truoc[0]?.daGhi !== false) {
    console.log(`\n${BANG_THAT} đã bật trigger thật — lượt kiểm này không nói được gì. Đổi BANG_THAT.`);
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`CREATE TABLE ${BANG_MOI} (id int)`));
      // Trigger MỒI: trùng tên trigger của `shipments`, nhưng nằm trên bảng vừa tạo.
      // Không bao giờ nổ (không ai ghi vào bảng này), nên đối số của hàm là gì cũng được.
      await tx.execute(sql.raw(
        `CREATE TRIGGER ${tenTrigger(BANG_THAT)} AFTER INSERT ON ${BANG_MOI} `
        + `FOR EACH ROW EXECUTE FUNCTION nhat_ky_ghi('id', '', '')`,
      ));

      const moi = await tx.execute<{ relname: string; tgname: string }>(sql`
        SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE t.tgname = ${tenTrigger(BANG_THAT)} AND NOT t.tgisinternal`);
      canh(
        moi.rows.some((x) => x.relname === BANG_MOI),
        `trigger mồi ${tenTrigger(BANG_THAT)} đã sống trên ${BANG_MOI} (có cái để lẫn)`,
      );

      // ĐÚNG câu mà màn hình dùng, chạy trên giao dịch đang mở nên nó THẤY mồi.
      const sau = await trangThaiGhiCua([BANG_THAT], tx);
      canh(
        sau[0]?.daGhi === false,
        `${BANG_THAT} VẪN là "chưa bật" dù có trigger trùng tên ở bảng khác`,
      );

      tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }

  const con = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ${BANG_MOI}`);
  canh(Number(con.rows[0]?.n) === 0, `${BANG_MOI} đã biến mất sau ROLLBACK`);

  console.log(loi === 0 ? '\nĐã ROLLBACK. Tất cả đều đúng.' : `\nĐã ROLLBACK. ${loi} chỗ SAI.`);
  if (loi > 0) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
