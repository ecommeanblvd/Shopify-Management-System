/**
 * So bản vá sắp ghi với giá trị ĐANG CÓ trong database, để bỏ qua lệnh ghi
 * không thay đổi gì.
 *
 * Vì sao cần: mỗi lượt sync-lark ghi lại ~3.770 dòng shipments và ~4.040 dòng
 * trạng thái, dù dữ liệu gần như không đổi — vì bản vá được dựng thẳng từ dữ
 * liệu Lark chứ không so với DB. Cộng với việc cron chạy khác vùng database
 * (~270ms/lệnh), đó là phần lớn trong 68 phút mỗi lượt (đo 05/09).
 *
 * `updatedAt` KHÔNG được tính là thay đổi — nó luôn khác, tính vào thì mọi dòng
 * đều "có thay đổi" và việc so sánh thành vô nghĩa.
 */

/** Cột chỉ để đánh dấu thời điểm ghi, không phải dữ liệu nghiệp vụ. */
const BO_QUA = new Set(['updatedAt', 'syncedAt']);

/** So một giá trị: numeric trong Postgres về JS là chuỗi ("1.600" vs "1.6"). */
function bang(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return ta === tb;
  }
  // Hai bên đều là số (hoặc chuỗi số) → so theo GIÁ TRỊ, không so chuỗi:
  // Postgres trả numeric là "1.600" còn ta dựng "1.6" — cùng một cân nặng.
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb;
  }
  return String(a) === String(b);
}

/**
 * THUẦN: bản vá có thật sự đổi gì so với dòng hiện tại không.
 * `hienTai` là null (chưa có dòng) → luôn cần ghi.
 */
export function coThayDoi(hienTai: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): boolean {
  if (!hienTai) return true;
  for (const [k, v] of Object.entries(patch)) {
    if (BO_QUA.has(k)) continue;
    if (!bang(hienTai[k], v)) return true;
  }
  return false;
}

/** THUẦN: lọc danh sách việc ghi, chỉ giữ cái thật sự đổi. Trả cả số đã bỏ qua. */
export function locViecGhi<T>(
  viec: T[],
  hienTaiCua: (v: T) => Record<string, unknown> | null | undefined,
  patchCua: (v: T) => Record<string, unknown>,
): { canGhi: T[]; boQua: number } {
  const canGhi = viec.filter((v) => coThayDoi(hienTaiCua(v), patchCua(v)));
  return { canGhi, boQua: viec.length - canGhi.length };
}
