/** THUẦN: so tên brand trên tiêu đề sheet với slug / tên hiển thị trong hệ thống. */

/** Bỏ dấu tiếng Việt, đ→d, thường, chỉ giữ chữ số: "Calista de Minh Thanh" → "calistademinhthanh", "Linh Phùng" → "linhphung". */
export function chuanTenBrand(x: string): string {
  return x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Khoảng cách sửa (Levenshtein) — chỉ dùng cho chuỗi ngắn. */
export function khoangCachSua(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * Tên trên sheet khớp một trong các tên hệ thống khi (sau chuẩn hoá): bằng nhau; là TIỀN TỐ ≥ 4 ký tự của tên hệ thống ("Eegen" ↔ "Eegen Studio",
 * "Lecia" ↔ "Lecia RTW"); hoặc lệch đúng 1 ký tự khi tên ≥ 8 ký tự ("MADDY HATE ROSE" ↔ "Maddy Hates Rose" — brand gõ thiếu chữ).
 */
export function khopTenBrand(tenSheet: string, ...tenHeThong: Array<string | null | undefined>): boolean {
  const t = chuanTenBrand(tenSheet);
  if (!t) return false;
  return tenHeThong.some((x) => {
    const h = chuanTenBrand(x ?? '');
    if (!h) return false;
    if (h === t) return true;
    if (t.length >= 4 && h.startsWith(t)) return true;
    return t.length >= 8 && h.length >= 8 && khoangCachSua(t, h) <= 1;
  });
}
