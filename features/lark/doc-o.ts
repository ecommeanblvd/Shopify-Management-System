/**
 * THUẦN: đọc giá trị MỘT ô Lark về dạng dùng được. Không I/O.
 *
 * Lark trả BỐN hình dạng khác nhau cho cùng một khái niệm "ô này có chữ gì", tuỳ loại cột:
 *   - cột chọn / số          → `'QC Pass'`, `1`
 *   - cột text nhiều đoạn    → `[{ text: '#MBLVD29466', type: 'text' }]`
 *   - cột LOOKUP / công thức → `{ type: 1, value: [{ text: '#MBLVD29466' }] }`  ← bọc thêm MỘT lớp
 *   - ô trống                → thiếu hẳn khoá, hoặc `null`, hoặc `''`
 *
 * Repo đã có ba bản đọc cục bộ (`dong-bo-wh-lark.ts`, `doi-chieu.ts`, `dien-store-final.ts`) và
 * KHÔNG bản nào đọc được hình dạng thứ ba — chúng đọc cột TEXT nên chưa bao giờ cần. Bảng
 * `LOG - Import` thì ba cột cần đọc (`Order number`, `SKU`, `WH - Tiếp nhận & QC`) đều là
 * lookup, nên phải có bản đủ. Chỗ mới dùng module này; ba bản cũ để nguyên (đổi chúng là sửa
 * những lượt đồng bộ đang chạy đúng), nhưng ghi ra đây để sự trùng lặp nhìn thấy được.
 */

/** Chuỗi của ô, hoặc `null` khi trống. Nhiều đoạn/nhiều giá trị thì nối lại. */
export function docChuO(v: unknown): string | null {
  const s = gom(v).join('').trim();
  return s === '' ? null : s;
}

/** Danh sách giá trị của ô (cột chọn nhiều giá trị, lookup trả nhiều dòng). */
export function docDanhSachO(v: unknown): string[] {
  return gom(v).map((x) => x.trim()).filter((x) => x !== '');
}

/** Số của ô, hoặc `null` khi trống/không đọc được. KHÔNG tự sửa thành 0. */
export function docSoO(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = docChuO(v);
  if (s == null) return null;
  // Bỏ dấu phân cách nghìn kiểu `1.234` / `1,234` trước khi đọc số.
  const n = Number(s.replace(/[\s.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function gom(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === 'string') return [v];
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(gom);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; name?: unknown; value?: unknown };
    // `value` TRƯỚC `text`: ô lookup bọc `{ type, value }`, và lớp trong mới mang chữ.
    if (o.value !== undefined) return gom(o.value);
    if (o.text !== undefined) return gom(o.text);
    if (o.name !== undefined) return gom(o.name);
    return [];
  }
  return [];
}
