/**
 * THUẦN: chấm điểm câu trả lời phong cách → 1 trong 6 style archetype (+ blend).
 * Xem spec §4 + scratchpad/research-archetype.md. Không I/O.
 *
 * CREDIBILITY: archetype = HƯỚNG SỞ THÍCH (preference), không phải "type cố định"
 * của khách. Line-theory (thẳng=sắc, cong=mềm) có cơ sở thiết kế; Kibbe-determinism
 * thì không. UI trình bày dạng spectrum (primary + "bạn cũng nghiêng về…").
 */

/** Thứ tự CỐ ĐỊNH của vector điểm: [classic, dramatic, romantic, natural, creative, edgy]. */
export const ARCHETYPES = ['classic', 'dramatic', 'romantic', 'natural', 'creative', 'edgy'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
type Vec6 = [number, number, number, number, number, number];

export interface ArchetypeOption { id: string; label: string; s: Vec6; }
export interface ArchetypeQuestion {
  id: string; prompt: string;
  type: 'image' | 'text' | 'slider' | 'multi';
  /** Q1 (outfit dinner) là câu dự báo mạnh nhất → weight 2. */
  weight: number;
  level: 1 | 2;
  options: ArchetypeOption[];
}

// Ma trận điểm từ research-archetype.md (mỗi option → [Cla,Dra,Rom,Nat,Cre,Edg]).
export const ARCHETYPE_QUESTIONS: ArchetypeQuestion[] = [
  { id: 'q1_dinner', prompt: 'Chọn outfit bạn muốn mặc đi ăn tối sang.', type: 'image', weight: 2, level: 1, options: [
    { id: 'blazer', label: 'Blazer tailored + quần âu', s: [4, 1, 0, 0, 0, 0] },
    { id: 'column', label: 'Đầm cột sleek + 1 phụ kiện nổi', s: [1, 4, 0, 0, 0, 1] },
    { id: 'floral', label: 'Đầm hoa bay + giày cao gót mảnh', s: [0, 0, 4, 0, 1, 0] },
    { id: 'knit', label: 'Áo len + denim tối + boots', s: [0, 0, 0, 4, 1, 0] },
    { id: 'maxi', label: 'Maxi layer + mix hoạ tiết + trang sức statement', s: [0, 0, 1, 1, 4, 0] },
    { id: 'leather', label: 'Áo da + slip dress + boots hầm hố', s: [0, 1, 0, 0, 1, 4] },
  ] },
  { id: 'q2_offduty', prompt: 'Đồng phục "off-duty" của bạn gần nhất với…', type: 'image', weight: 1, level: 1, options: [
    { id: 'crisp', label: 'Sơ mi crisp + quần thẳng', s: [3, 1, 0, 1, 0, 0] },
    { id: 'mono', label: 'Món gì đó sắc, đơn sắc', s: [1, 3, 0, 0, 0, 1] },
    { id: 'soft', label: 'Đầm/chân váy mềm', s: [0, 0, 3, 0, 1, 0] },
    { id: 'jeans', label: 'Jeans, tee, sneakers', s: [0, 0, 0, 3, 0, 1] },
    { id: 'layer', label: 'Layer tuỳ hứng', s: [0, 0, 1, 1, 3, 0] },
    { id: 'hoodie', label: 'Hoodie/cargo hoặc all-black + boots', s: [0, 0, 0, 1, 0, 3] },
  ] },
  { id: 'q3_comfort', prompt: 'Thoải mái ↔ chỉn chu, bạn ở đâu?', type: 'slider', weight: 1, level: 1, options: [
    { id: 'comfort', label: 'Thoải mái luôn thắng', s: [0, 0, 0, 3, 2, 1] },
    { id: 'both', label: 'Cả hai', s: [1, 0, 1, 1, 1, 0] },
    { id: 'polish', label: 'Chịu đánh đổi để trông sắc/chỉn chu', s: [2, 3, 1, 0, 0, 0] },
  ] },
  { id: 'q4_print', prompt: 'Chọn hoạ tiết bạn thật sự sẽ mua.', type: 'image', weight: 1, level: 2, options: [
    { id: 'solid', label: 'Trơn / kẻ nhỏ gọn', s: [3, 1, 0, 1, 0, 0] },
    { id: 'geo', label: 'Hình học đậm / color-block lớn', s: [0, 3, 0, 0, 1, 1] },
    { id: 'floral', label: 'Hoa nhí / chấm bi', s: [0, 0, 3, 0, 1, 0] },
    { id: 'plaid', label: 'Melange / kẻ caro nhẹ', s: [1, 0, 0, 3, 0, 0] },
    { id: 'paisley', label: 'Paisley / folk / mix print', s: [0, 0, 1, 0, 3, 0] },
    { id: 'camo', label: 'Camo / graphic / distressed', s: [0, 1, 0, 0, 0, 3] },
  ] },
  { id: 'q5_fabric', prompt: 'Chất liệu nào "chất bạn" nhất?', type: 'image', weight: 1, level: 2, options: [
    { id: 'wool', label: 'Len mịn / cotton crisp', s: [3, 1, 0, 0, 0, 0] },
    { id: 'crepe', label: 'Crepe cấu trúc / satin / da bóng', s: [1, 3, 0, 0, 0, 1] },
    { id: 'chiffon', label: 'Chiffon / ren / lụa', s: [0, 0, 3, 0, 1, 0] },
    { id: 'linen', label: 'Linen / denim / len mềm', s: [0, 0, 0, 3, 1, 0] },
    { id: 'velvet', label: 'Nhung / thêu / crochet', s: [0, 0, 1, 0, 3, 0] },
    { id: 'leather', label: 'Da / coated / technical', s: [0, 1, 0, 0, 0, 3] },
  ] },
  { id: 'q6_lookas', prompt: 'Khi diện lên bạn muốn trông…', type: 'text', weight: 1, level: 1, options: [
    { id: 'refined', label: 'Chỉn chu (Refined)', s: [3, 0, 0, 0, 0, 0] },
    { id: 'striking', label: 'Ấn tượng (Striking)', s: [0, 3, 0, 0, 0, 0] },
    { id: 'pretty', label: 'Duyên dáng (Pretty)', s: [0, 0, 3, 0, 0, 0] },
    { id: 'easy', label: 'Tự nhiên (Easy)', s: [0, 0, 0, 3, 0, 0] },
    { id: 'original', label: 'Cá tính riêng (Original)', s: [0, 0, 0, 0, 3, 0] },
    { id: 'cool', label: 'Ngầu/cứng (Cool)', s: [0, 0, 0, 0, 0, 3] },
  ] },
  { id: 'q7_line', prompt: 'Chọn kiểu cổ/đường cắt bạn thích.', type: 'image', weight: 1, level: 2, options: [
    { id: 'vnotch', label: 'V/notch gọn (góc cạnh)', s: [1, 2, 0, 0, 0, 1] },
    { id: 'crew', label: 'Cổ tròn/thẳng đối xứng', s: [3, 0, 0, 0, 0, 0] },
    { id: 'scoop', label: 'Scoop/sweetheart/bèo (cong)', s: [0, 0, 3, 0, 0, 0] },
    { id: 'drape', label: 'Thả/cowl (thoải mái)', s: [0, 0, 0, 2, 1, 0] },
    { id: 'asym', label: 'Bất đối xứng/lạ', s: [0, 0, 0, 0, 3, 1] },
  ] },
  { id: 'q8_palette', prompt: 'Bảng màu bạn bị hút.', type: 'image', weight: 1, level: 2, options: [
    { id: 'neutral', label: 'Trung tính (navy/camel/xám)', s: [3, 1, 0, 1, 0, 0] },
    { id: 'jewel', label: 'Tương phản cao / jewel', s: [0, 3, 0, 0, 1, 1] },
    { id: 'pastel', label: 'Pastel mềm / blush', s: [0, 0, 3, 0, 1, 0] },
    { id: 'earthy', label: 'Đất/muted (olive/rust/sand)', s: [0, 0, 0, 3, 1, 0] },
    { id: 'eclectic', label: 'Ấm eclectic (mustard/teal/plum)', s: [0, 0, 0, 0, 3, 0] },
    { id: 'black', label: 'Chủ yếu đen + 1 điểm nhấn sắc', s: [0, 1, 0, 0, 0, 3] },
  ] },
];

export const ARCHETYPE_KEYWORDS: Record<Archetype, string[]> = {
  classic: ['classic', 'timeless', 'tailored', 'refined', 'minimal', 'preppy'],
  dramatic: ['dramatic', 'bold', 'statement', 'sleek', 'structured', 'sharp'],
  romantic: ['romantic', 'floral', 'lace', 'ruffle', 'feminine', 'delicate', 'bow', 'soft'],
  natural: ['relaxed', 'casual', 'effortless', 'linen', 'denim', 'knit'],
  creative: ['boho', 'bohemian', 'eclectic', 'print', 'embroidered', 'artistic', 'layered'],
  edgy: ['edgy', 'leather', 'moto', 'street', 'utility', 'graphic', 'grunge'],
};

// Tie-break theo trục lệch của từng cặp (research §B.3): key = cặp sort, value =
// {question, chọn option nào → archetype nào thắng}.
const TIE_BREAKS: Array<{ pair: [Archetype, Archetype]; q: string; win: Record<string, Archetype> }> = [
  { pair: ['dramatic', 'edgy'], q: 'q3_comfort', win: { polish: 'dramatic', comfort: 'edgy' } },
  { pair: ['creative', 'natural'], q: 'q4_print', win: { plaid: 'natural', solid: 'natural', paisley: 'creative', geo: 'creative' } },
  { pair: ['classic', 'romantic'], q: 'q7_line', win: { crew: 'classic', vnotch: 'classic', scoop: 'romantic' } },
  { pair: ['classic', 'dramatic'], q: 'q8_palette', win: { neutral: 'classic', jewel: 'dramatic', black: 'dramatic' } },
];

export interface ArchetypeResult {
  primary: Archetype;
  secondary: Archetype | null;
  scores: Record<Archetype, number>;
  keywords: string[];
  confidence: 'coarse' | 'refined';
}

function tieBreak(a: Archetype, b: Archetype, answers: Record<string, string | string[]>): Archetype | null {
  for (const tb of TIE_BREAKS) {
    if ((tb.pair[0] === a && tb.pair[1] === b) || (tb.pair[0] === b && tb.pair[1] === a)) {
      const sel = answers[tb.q];
      const id = Array.isArray(sel) ? sel[0] : sel;
      if (id && tb.win[id]) return tb.win[id];
    }
  }
  return null;
}

export function scoreArchetype(
  answers: Record<string, string | string[]>,
  opts?: { refined?: boolean },
): ArchetypeResult {
  const totals: Vec6 = [0, 0, 0, 0, 0, 0];
  let answered = 0;
  for (const q of ARCHETYPE_QUESTIONS) {
    const sel = answers[q.id];
    if (sel == null) continue;
    answered += 1;
    for (const id of Array.isArray(sel) ? sel : [sel]) {
      const opt = q.options.find((o) => o.id === id);
      if (!opt) continue;
      for (let i = 0; i < 6; i++) totals[i] += opt.s[i] * q.weight;
    }
  }

  const scored = ARCHETYPES.map((a, i) => ({ a, v: totals[i] }))
    .sort((x, y) => y.v - x.v || ARCHETYPES.indexOf(x.a) - ARCHETYPES.indexOf(y.a));

  let primary = scored[0].a;
  if (scored[1] && scored[1].v === scored[0].v) {
    primary = tieBreak(scored[0].a, scored[1].a, answers) ?? scored[0].a;
  }
  const primaryScore = totals[ARCHETYPES.indexOf(primary)];
  // Secondary = archetype cao thứ 2 nếu là "lean" đáng kể (≥40% primary) — hầu
  // hết người là blend (research §B.3), nhưng đừng surface nhiễu quá yếu.
  const others = scored.filter((s) => s.a !== primary);
  const secondary = others.length > 0 && primaryScore > 0 && others[0].v >= 0.40 * primaryScore
    ? others[0].a : null;

  const scores = Object.fromEntries(ARCHETYPES.map((a, i) => [a, totals[i]])) as Record<Archetype, number>;
  const keywords = [...new Set([...ARCHETYPE_KEYWORDS[primary], ...(secondary ? ARCHETYPE_KEYWORDS[secondary] : [])])];
  const confidence: 'coarse' | 'refined' = opts?.refined === true && answered >= 6 ? 'refined' : 'coarse';

  return { primary, secondary, scores, keywords, confidence };
}
