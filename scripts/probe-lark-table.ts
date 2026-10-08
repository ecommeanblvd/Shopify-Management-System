/**
 * Dò MỘT bảng Lark: tên cột, kiểu cột, lựa chọn của cột CHỌN, và vài dòng mẫu. CHỈ ĐỌC.
 *
 * Vì sao cần (08/10/2026): để viết lượt đồng bộ cho một bảng mới thì phải biết TÊN CỘT NGUYÊN
 * VĂN — sai một ký tự là Lark trả `undefined` và im lặng bỏ qua cả bảng, không báo lỗi. Khoá
 * Lark chỉ nằm trên Railway nên lệnh này chạy ở đó, không chạy trên máy lập trình.
 *
 * Dùng:
 *   npm run probe:lark-table -- <tableId> [appToken]
 *   npm run probe:lark-table              # không tham số: liệt kê MỌI bảng trong base
 *
 * `appToken` để trống thì dùng base mặc định (`LARK_BASE_APP_TOKEN`).
 */
import { listTableFields, listBaseTables, peekTableRecords } from '@/features/lark/client';

const BASE_WH = 'HxfAw0iRViHiNgkSlbBltpVkg3f';

async function main() {
  const [tableId, appToken] = process.argv.slice(2);
  const token = appToken || BASE_WH;

  if (!tableId) {
    console.log(`=== BẢNG trong base ${token} ===`);
    for (const t of await listBaseTables(token)) console.log(`${t.table_id}  ${t.name}`);
    return;
  }

  console.log(`=== CỘT của ${tableId} (base ${token}) ===`);
  for (const f of await listTableFields(tableId, token)) {
    const opts = (f as { property?: { options?: { name: string }[] } }).property?.options;
    const them = opts?.length ? `  [${opts.map((o) => o.name).join(' | ')}]` : '';
    console.log(`type=${String(f.type).padStart(3)}  ${f.field_name}${them}`);
  }

  console.log(`\n=== 3 DÒNG MẪU ===`);
  for (const r of await peekTableRecords(tableId, 3, token)) {
    console.log(`--- ${r.record_id}`);
    console.log(JSON.stringify(r.fields, null, 1));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
