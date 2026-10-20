/**
 * Bật / gỡ trigger nhật ký thay đổi cho MỘT bảng.
 *
 *   tsx scripts/nhat-ky-bat-tat.ts --bang=goods_receipt_items             # chạy thử, chỉ in SQL
 *   tsx scripts/nhat-ky-bat-tat.ts --bang=goods_receipt_items --ap-dung   # bật thật
 *   tsx scripts/nhat-ky-bat-tat.ts --bang=goods_receipt_items --tat --ap-dung
 *
 * Vì sao là công cụ riêng, không nằm trong tệp di trú (0210): trigger là thứ DUY NHẤT của
 * tính năng này có thể làm hỏng lệnh ghi của module khác — hàm trigger ném lỗi là mọi
 * `INSERT`/`UPDATE` vào bảng đó đổ theo. Nên nó phải bật được từng bảng một, gỡ được ngay
 * lập tức, và không bao giờ tự sống lại chỉ vì ai đó áp lại di trú.
 *
 * Vì sao đọc cột THẬT từ `information_schema` chứ không từ `db/schema.ts`: chế độ `tru`
 * nghĩa là "ghi mọi cột trừ danh sách loại trừ", nên danh sách cột phải là cột ĐANG CÓ trên
 * CSDL. `db/schema.ts` ở repo này là bản mirror lỏng (di trú áp tay, xem
 * db/migrations/README.md) — tin nó là bỏ sót đúng những cột vừa thêm bằng tay.
 *
 * Mặc định CHẠY THỬ. `--ap-dung` mới ghi.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { CAU_HINH } from '@/features/nhat-ky/cot-theo-doi';
import { sinhTrigger, sinhGoTrigger } from '@/features/nhat-ky/sinh-trigger';

const apDung = process.argv.includes('--ap-dung');
const tat = process.argv.includes('--tat');
const bang = process.argv.find((a) => a.startsWith('--bang='))?.slice('--bang='.length) ?? '';

async function moiCotCua(ten: string): Promise<string[]> {
  const r = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${ten}
     ORDER BY ordinal_position`);
  return r.rows.map((x) => x.column_name);
}

async function main(): Promise<void> {
  if (!bang) {
    console.error('Thiếu --bang=<tên bảng>. Bảng đã khai: ' + CAU_HINH.map((c) => c.bang).join(', '));
    process.exit(2);
  }

  const ch = CAU_HINH.find((c) => c.bang === bang);
  if (!ch) {
    // Bảng không khai trong CAU_HINH thì không có danh sách cột để theo dõi — bật trigger
    // cho nó là bật một trigger không ai quyết định nội dung, nên chết tại đây.
    console.error(`Bảng ${bang} chưa khai trong CAU_HINH (features/nhat-ky/cot-theo-doi.ts).`);
    process.exit(2);
  }

  let cauLenh: string[];
  if (tat) {
    cauLenh = [sinhGoTrigger(bang)];
  } else {
    const moiCot = await moiCotCua(bang);
    if (moiCot.length === 0) {
      console.error(`Bảng ${bang} không có cột nào trong information_schema — bảng có thật không?`);
      process.exit(2);
    }
    // GỠ trước rồi TẠO: `CREATE TRIGGER` không có dạng `OR REPLACE`, nên muốn lệnh này chạy
    // lại được (và muốn cập nhật danh sách cột sau khi bảng thêm cột) thì phải gỡ cái cũ.
    cauLenh = [sinhGoTrigger(bang), sinhTrigger(ch, moiCot)];
    console.log(`Bảng ${bang}: ${moiCot.length} cột trên CSDL, chế độ ${ch.cheDo}.`);
  }

  console.log(`\nSQL sẽ chạy (${tat ? 'GỠ' : 'BẬT'}):`);
  for (const c of cauLenh) console.log(`  ${c}`);

  if (!apDung) {
    console.log('\n(chạy thử — thêm --ap-dung để chạy thật)');
    return;
  }

  // Cả gỡ-và-tạo trong MỘT giao dịch: nếu `CREATE TRIGGER` đổ thì `DROP` cũng lùi theo, chứ
  // không để bảng ở trạng thái "vừa mất trigger cũ, chưa có trigger mới".
  await db.transaction(async (tx) => {
    for (const c of cauLenh) await tx.execute(sql.raw(c));
  });

  const con = await db.execute<{ tgname: string }>(sql`
    SELECT t.tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = ${bang} AND NOT t.tgisinternal AND t.tgname = ${'nhat_ky_' + bang}`);
  console.log(`\nĐã chạy. Trigger nhat_ky_${bang} trên CSDL: ${con.rows.length === 1 ? 'CÓ' : 'KHÔNG'}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
