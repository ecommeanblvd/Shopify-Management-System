/**
 * Dò MỘT bảng Lark: tên cột, kiểu cột, lựa chọn của cột CHỌN, và vài dòng mẫu. CHỈ ĐỌC.
 *
 * Vì sao cần (08/10/2026): để viết lượt đồng bộ cho một bảng mới thì phải biết TÊN CỘT NGUYÊN
 * VĂN — sai một ký tự là Lark trả `undefined` và im lặng bỏ qua cả bảng, không báo lỗi. Khoá
 * Lark chỉ nằm trên Railway nên lệnh này chạy ở đó, không chạy trên máy lập trình.
 *
 * Dùng (khoá lấy từ Railway, KHÔNG ghi xuống đĩa):
 *   railway run npm run probe:lark-table                      # liệt kê MỌI bảng trong base
 *   railway run npm run probe:lark-table -- <tableId>         # cột + 3 dòng mẫu
 *   railway run npm run probe:lark-table -- <tableId> --cot   # CHỈ cột
 *   railway run npm run probe:lark-table -- <tableId> --dong  # CHỈ dòng mẫu
 *
 * `--cot` có vì bảng nhiều cột thì output dài hơn khung cuộn của terminal và phần ĐẦU bị cắt —
 * đúng phần cần đọc (đo 08/10/2026 với bảng `LOG - Import`).
 *
 * Tham số không bắt đầu bằng `--` thứ hai là `appToken`; để trống thì dùng base WH.
 */
import { listTableFields, listBaseTables, peekTableRecords } from '@/features/lark/client';

const BASE_WH = 'HxfAw0iRViHiNgkSlbBltpVkg3f';

async function main() {
  const args = process.argv.slice(2);
  const co = args.filter((a) => a.startsWith('--'));
  const [tableId, appToken] = args.filter((a) => !a.startsWith('--'));
  const token = appToken || BASE_WH;
  const chiCot = co.includes('--cot');
  const chiDong = co.includes('--dong');

  if (!tableId) {
    console.log(`=== BẢNG trong base ${token} ===`);
    for (const t of await listBaseTables(token)) console.log(`${t.table_id}  ${t.name}`);
    return;
  }

  if (!chiDong) {
    const cot = await listTableFields(tableId, token);
    console.log(`=== ${cot.length} CỘT của ${tableId} (base ${token}) ===`);
    for (const f of cot) {
      const opts = (f as { property?: { options?: { name: string }[] } }).property?.options;
      const them = opts?.length ? `  [${opts.map((o) => o.name).join(' | ')}]` : '';
      console.log(`type=${String(f.type).padStart(3)}  ${f.field_name}${them}`);
    }
  }

  if (!chiCot) {
    console.log(`\n=== 3 DÒNG MẪU ===`);
    for (const r of await peekTableRecords(tableId, 3, token)) {
      console.log(`--- ${r.record_id}`);
      console.log(JSON.stringify(r.fields, null, 1));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
