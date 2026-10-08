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
 *   railway run npm run probe:lark-table -- <tableId> --cot --chitiet --loc=WH
 *       # CHỈ cột có tên chứa "WH", in NGUYÊN cấu hình cột
 *   railway run npm run probe:lark-table -- <tableId> --dem="Return Status"
 *       # ĐẾM số dòng theo từng giá trị của cột đó (lặp `--dem=` được nhiều cột)
 *   railway run npm run probe:lark-table -- <tableId> --cheo="Cột A|Cột B"
 *       # BẢNG CHÉO: với mỗi giá trị cột A, phân bố cột B. Để chọn luật lọc bằng số thay vì
 *       # bằng suy đoán — một cột lẻ không đủ, phải biết chúng đi cùng nhau thế nào.
 *
 * `--chitiet` cần cho cột LOOKUP (type 19) và cột liên kết (18/21): tên cột không nói nó lấy dữ
 * liệu qua liên kết nào, mà ghi sai hướng liên kết là bảng vận hành hiện số của bản ghi khác.
 * `--loc` để output không dài hơn khung cuộn rồi bị cắt mất phần đầu (bảng `LOG - Import` có 48
 * cột; in nguyên cấu hình cả 48 là mất sạch).
 *
 * `--cot` có vì bảng nhiều cột thì output dài hơn khung cuộn của terminal và phần ĐẦU bị cắt —
 * đúng phần cần đọc (đo 08/10/2026 với bảng `LOG - Import`).
 *
 * Tham số không bắt đầu bằng `--` thứ hai là `appToken`; để trống thì dùng base WH.
 */
import {
  listTableFields, listBaseTables, peekTableRecords, listTableRecords,
} from '@/features/lark/client';

const BASE_WH = 'HxfAw0iRViHiNgkSlbBltpVkg3f';

/**
 * Giá trị một ô về dạng CHỮ để gộp nhóm. Lark trả bốn hình dạng khác nhau cho cùng một khái
 * niệm "ô có chữ gì": chuỗi thường (cột chọn), mảng đoạn chữ (cột text nhiều định dạng), bọc
 * `{type, value}` (cột lookup/công thức), hoặc thiếu hẳn khoá. Trộn lẫn bốn hình dạng đó là
 * đếm ra bốn nhóm cho một giá trị.
 */
function giaTri(fields: Record<string, unknown> | undefined, ten: string): string {
  const v = fields?.[ten];
  if (v == null) return '(trống)';
  if (typeof v === 'string') return v.trim() || '(trống)';
  if (Array.isArray(v)) {
    return v.map((x) => (x as { text?: string })?.text ?? String(x)).join('').trim() || '(trống)';
  }
  if (typeof v === 'object' && 'value' in (v as object)) {
    const ds = (v as { value?: unknown[] }).value ?? [];
    return ds.map((x) => (x as { text?: string })?.text ?? String(x)).join(',').trim() || '(trống)';
  }
  return String(v);
}

async function main() {
  const args = process.argv.slice(2);
  const co = args.filter((a) => a.startsWith('--'));
  const [tableId, appToken] = args.filter((a) => !a.startsWith('--'));
  const token = appToken || BASE_WH;
  const chiCot = co.includes('--cot');
  const chiDong = co.includes('--dong');
  const chiTiet = co.includes('--chitiet');
  const loc = (co.find((a) => a.startsWith('--loc='))?.slice(6) ?? '').toLowerCase();

  if (!tableId) {
    console.log(`=== BẢNG trong base ${token} ===`);
    for (const t of await listBaseTables(token)) console.log(`${t.table_id}  ${t.name}`);
    return;
  }

  const demCot = co.filter((a) => a.startsWith('--dem=')).map((a) => a.slice(6));
  const cheoCot = co.filter((a) => a.startsWith('--cheo=')).map((a) => a.slice(7));
  if (demCot.length > 0 || cheoCot.length > 0) {
    const ds = await listTableRecords(tableId, token);
    console.log(`=== ${ds.length} dòng của ${tableId} ===`);

    for (const ten of demCot) {
      const dem = new Map<string, number>();
      for (const r of ds) dem.set(giaTri(r.fields, ten), (dem.get(giaTri(r.fields, ten)) ?? 0) + 1);
      console.log(`\n--- ${ten}`);
      for (const [k, n] of [...dem].sort((a, b) => b[1] - a[1])) {
        console.log(`${String(n).padStart(5)}  ${k}`);
      }
    }

    for (const cap of cheoCot) {
      const [a, b] = cap.split('|');
      if (!a || !b) { console.log(`\n--- BỎ QUA "${cap}": cần dạng "Cột A|Cột B"`); continue; }
      const bang = new Map<string, Map<string, number>>();
      for (const r of ds) {
        const ka = giaTri(r.fields, a), kb = giaTri(r.fields, b);
        const hang = bang.get(ka) ?? new Map<string, number>();
        hang.set(kb, (hang.get(kb) ?? 0) + 1);
        bang.set(ka, hang);
      }
      console.log(`\n--- CHÉO: ${a}  ×  ${b}`);
      const tong = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
      for (const [ka, hang] of [...bang].sort((x, y) => tong(y[1]) - tong(x[1]))) {
        console.log(`${String(tong(hang)).padStart(5)}  ${ka}`);
        for (const [kb, n] of [...hang].sort((x, y) => y[1] - x[1])) {
          console.log(`        ${String(n).padStart(5)}  ${kb}`);
        }
      }
    }
    return;
  }

  if (!chiDong) {
    const tatCa = await listTableFields(tableId, token);
    const cot = loc ? tatCa.filter((f) => f.field_name.toLowerCase().includes(loc)) : tatCa;
    console.log(`=== ${cot.length}/${tatCa.length} CỘT của ${tableId} (base ${token}) ===`);
    for (const f of cot) {
      if (chiTiet) {
        console.log(`--- type=${f.type}  ${f.field_name}`);
        console.log(JSON.stringify(f, null, 1));
        continue;
      }
      /* In kèm `field_id` và MÃ lựa chọn: công thức lookup/formula của Lark chỉ nhắc tới id
       * (`fldieyuRe2`, `optbMU1739`), không nhắc tên — không có bảng tra id→tên thì đọc công
       * thức ra chỉ biết "khớp một cột nào đó với một lựa chọn nào đó". */
      const opts = (f as { property?: { options?: { id?: string; name: string }[] } })
        .property?.options;
      const them = opts?.length
        ? `  [${opts.map((o) => `${o.id ?? '?'}:${o.name}`).join(' | ')}]` : '';
      console.log(`${(f.field_id ?? '').padEnd(12)} type=${String(f.type).padStart(3)}  ${f.field_name}${them}`);
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

/**
 * Thử lại khi mạng chớp. Đo 08/10/2026: hai lượt dò chết vì `UND_ERR_CONNECT_TIMEOUT` tới
 * endpoint Lark, lượt chạy lại thì xong ngay — một lệnh CHỈ ĐỌC không có lý gì bắt người dùng
 * tự chạy lại. Chỉ thử lại lỗi KẾT NỐI; lỗi Lark trả về (sai mã bảng, thiếu quyền) thì dừng
 * ngay, vì thử lại một câu trả lời dứt khoát là vô nghĩa và làm chậm chẩn đoán.
 */
const LA_LOI_MANG = (e: unknown): boolean => {
  const s = `${(e as { message?: string })?.message ?? ''} ${(e as { cause?: { code?: string } })?.cause?.code ?? ''}`;
  return /fetch failed|TIMEOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(s);
};

async function chay(): Promise<void> {
  const SO_LAN = 4;
  for (let i = 1; i <= SO_LAN; i++) {
    try {
      await main();
      return;
    } catch (e) {
      if (i === SO_LAN || !LA_LOI_MANG(e)) throw e;
      const cho = i * 3000;
      console.error(`[dò] lỗi mạng lần ${i}/${SO_LAN}, thử lại sau ${cho / 1000}s…`);
      await new Promise((r) => setTimeout(r, cho));
    }
  }
}

chay().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
