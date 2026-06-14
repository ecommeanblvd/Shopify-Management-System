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
  // SA — An Nairyah (النعيرية): đơn ghi "Al-Nairiya" → ALNAIRIYA / NAIRIYA, list
  // DHL ghi "NAIRYAH" (đảo I↔Y) nên prefix/suffix không bắt được. (#MBLVD28010)
  NAIRIYA: 'NAIRYAH',
  ALNAIRIYA: 'NAIRYAH',
  // SA — Al Majma'ah (المجمعة): đơn ghi "Majma" (cắt cụt) → MAJMA, list "MAJMAAH".
  // (#MBLVD28112)
  MAJMA: 'MAJMAAH',
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

/** Fuzzy chỉ ở RÌA (prefix/suffix) — KHÔNG substring giữa (tránh khớp nhầm như
 *  "ALQASSIM" chứa một pattern ngắn nằm giữa). Pattern phải đủ dài:
 *  - PREFIX (city bắt đầu bằng pattern): ≥5 — bắt "BURAIDAHALQASSIM" (city+vùng).
 *  - SUFFIX (city kết thúc bằng pattern): ≥6 — bắt "ALRUWAISALSHAMAL" (vùng+town). */
const MIN_PREFIX_LEN = 5;
const MIN_SUFFIX_LEN = 6;

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
  // 2. RÌA: prefix (≥5) hoặc suffix (≥6). Lấy pattern KHỚP DÀI NHẤT (cụ thể nhất → an toàn nhất).
  let best: { tier: string | null; len: number } | null = null;
  const cands = candidates.flatMap((c) => expand(c));
  for (const [key, tier] of patterns) {
    const klen = key.length;
    if (klen < MIN_PREFIX_LEN) continue;
    for (const c of cands) {
      const hit = (klen >= MIN_PREFIX_LEN && c.startsWith(key)) || (klen >= MIN_SUFFIX_LEN && c.endsWith(key));
      if (hit && (!best || klen > best.len)) best = { tier: tier ?? null, len: klen };
    }
  }
  return best ? { tier: best.tier } : null;
}
