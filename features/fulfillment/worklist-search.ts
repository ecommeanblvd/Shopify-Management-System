/**
 * THUẦN: tìm kiếm trong worklist Quản lí đơn. Dữ liệu đã nằm sẵn ở client
 * (query lấy toàn bộ đơn) nên lọc tại chỗ — gõ tới đâu thấy tới đó, không
 * round-trip. Không I/O.
 */

export interface SearchableWorklistRow {
  orderNumber: string | null;
  storeName: string | null;
  tracks: Array<{ trackingNumber: string }>;
}

/**
 * Chuẩn hoá để so khớp: bỏ dấu tiếng Việt, bỏ '#' (ops gõ 'MBLVD29431' hay
 * '#MBLVD29431' đều ra), gom khoảng trắng, về chữ thường.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/#/g, '')
    .toLowerCase()
    .trim();
}

/** Tách query thành các từ khoá (AND). Query rỗng → mảng rỗng. */
export function queryTokens(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

/** Chuỗi gộp mọi trường tìm được của 1 dòng: mã đơn + store + mọi tracking. */
function haystack(row: SearchableWorklistRow): string {
  return normalizeText([
    row.orderNumber ?? '',
    row.storeName ?? '',
    ...row.tracks.map((t) => t.trackingNumber),
  ].join(' '));
}

/** MỌI từ khoá phải xuất hiện (AND) — gõ 'mblvd kalisa' lọc hẹp dần. */
export function matchesWorklistQuery(row: SearchableWorklistRow, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = haystack(row);
  return tokens.every((t) => hay.includes(t));
}

/** Lọc danh sách theo query người dùng gõ. Query rỗng → giữ nguyên. */
export function filterWorklist<T extends SearchableWorklistRow>(rows: T[], query: string): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return rows;
  return rows.filter((r) => matchesWorklistQuery(r, tokens));
}
