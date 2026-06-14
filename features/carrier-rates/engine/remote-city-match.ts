/**
 * So khớp city đích với danh sách remote/ODA của carrier — TOLERANT vì city trên
 * đơn Shopify hay sai chính tả / dư tiền tố / dính tên vùng so với list ODA.
 * Thuần, có test. Thứ tự ưu tiên (dừng ở match đầu tiên có ý nghĩa nhất):
 *   1. EXACT trên các candidate (đã chuẩn hoá A-Z0-9) + biến thể: alias + bỏ "AL".
 *   2. PREFIX: candidate BẮT ĐẦU bằng một pattern (pattern ≥5 ký tự) — bắt
 *      "BURAIDAHALQASSIM" (city + vùng) khớp "BURAIDAH". Lấy pattern dài nhất.
 * Không dùng substring tuỳ ý (tránh khớp nhầm). Trả null nếu không khớp; trả
 * { tier } (tier có thể null = không phân bậc) nếu khớp.
 */

/** Biến thể chính tả đã gặp trên đơn thật (chuẩn hoá → chuẩn hoá list). */
const CITY_ALIASES: Record<string, string> = {
  BURYDAH: 'BURAYDAH', // "Burydah" thiếu chữ A so với "Buraydah"
};

/** Bỏ tiền tố mạo từ "AL" ("Al Duwadimi" → "ALDUWADIMI" → "DUWADIMI"). */
function stripAlPrefix(s: string): string {
  return s.length > 4 && s.startsWith('AL') ? s.slice(2) : s;
}

/** Mở rộng một candidate thành các dạng để thử EXACT. */
function expand(c: string): string[] {
  const out = new Set<string>([c]);
  const a = CITY_ALIASES[c];
  if (a) out.add(a);
  out.add(stripAlPrefix(c));
  if (a) out.add(stripAlPrefix(a));
  return [...out].filter((x) => x.length > 0);
}

/** PREFIX match tối thiểu để chặn nhiễu — chỉ pattern đủ dài mới được dùng. */
const MIN_PREFIX_LEN = 5;

export function matchRemoteCity(
  candidates: string[],
  patterns: Map<string, string | null>,
): { tier: string | null } | null {
  // 1. EXACT (gồm alias + bỏ AL)
  for (const cand of candidates) {
    for (const c of expand(cand)) {
      if (patterns.has(c)) return { tier: patterns.get(c) ?? null };
    }
  }
  // 2. PREFIX: candidate bắt đầu bằng pattern (≥ MIN_PREFIX_LEN), lấy pattern dài nhất.
  let best: { tier: string | null; len: number } | null = null;
  for (const [key, tier] of patterns) {
    if (key.length < MIN_PREFIX_LEN) continue;
    for (const cand of candidates) {
      for (const c of expand(cand)) {
        if (c.startsWith(key) && (!best || key.length > best.len)) {
          best = { tier: tier ?? null, len: key.length };
        }
      }
    }
  }
  return best ? { tier: best.tier } : null;
}
