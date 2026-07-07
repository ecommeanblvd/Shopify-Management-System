/**
 * THUẦN: xác định dáng người (5 bucket) từ số đo (FFIT — classifier peer-review,
 * Simmons/Istook/Devarajan NC State 2004) HOẶC vote câu hỏi khi không có số đo.
 * Xem spec §3 + scratchpad/research-body.md. Không I/O.
 *
 * CREDIBILITY: FFIT taxonomy validate; nhưng ±40% đổi nhóm khi lệch vị trí đo →
 * trả PRIMARY + SECONDARY + confidence, recommender dùng SOFT weight (không hard
 * filter), cho phép sở thích override. Copy: "dáng thường hợp bạn", không cấm.
 */

export const BODY_SHAPES = ['hourglass', 'pear', 'apple', 'rectangle', 'invertedTriangle'] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];
export type HeightBand = 'petite' | 'regular' | 'tall';
export type Proportion = 'longTorsoShortLegs' | 'balanced' | 'shortTorsoLongLegs';

export interface Measurements { bust: number; waist: number; hips: number; highHip?: number; }

export interface BodyResult {
  shape: BodyShape;
  secondary: BodyShape | null;
  confidence: 'coarse' | 'refined';
  heightBand: HeightBand;
  proportion: Proportion;
  /** true nếu suy từ số đo (FFIT) thay vì vote — tin cậy hơn. */
  fromMeasurements: boolean;
}

/**
 * FFIT classifier (số đo inch). Thứ tự khớp trước thắng. Apple (eo là girth lớn
 * nhất) kiểm TRƯỚC rectangle vì eo-dominant là quyết định (proxy cho diamond/oval
 * mà FFIT gốc cần số đo bụng — quiz không thu). Trả 5-bucket khách hàng.
 */
export function classifyFFIT(m: Measurements): BodyShape {
  // highHip thiếu → ước lượng trung tính (giữa waist & hips); KHÔNG mặc định =hips
  // vì sẽ giả ra "shelf" cao hông làm kích nhầm spoon.
  const b = m.bust, w = m.waist, h = m.hips, hh = m.highHip ?? (m.waist + m.hips) / 2;
  const bMinusH = b - h, hMinusB = h - b, bMinusW = b - w, hMinusW = h - w;

  if (bMinusH <= 1 && hMinusB < 3.6 && (bMinusW >= 9 || hMinusW >= 10)) return 'hourglass'; // hourglass
  if (hMinusB >= 3.6 && hMinusB < 10 && hMinusW >= 9 && hh / w < 1.193) return 'hourglass';  // bottom hourglass
  if (bMinusH > 1 && bMinusH < 10 && bMinusW >= 9) return 'hourglass';                        // top hourglass
  if (hMinusB > 2 && hMinusW >= 7 && hh / w >= 1.193) return 'hourglass';                     // spoon
  if (hMinusB >= 3.6 && hMinusW < 9) return 'pear';                                           // triangle
  if (bMinusH >= 3.6 && bMinusW < 9) return 'invertedTriangle';                               // inverted
  if (w >= b || w >= h) return 'apple';                                                       // apple/oval/diamond (eo dominant)
  return 'rectangle';                                                                         // fallthrough
}

// ── Vote khi không có số đo ──────────────────────────────────────────────
// Mỗi optionId → các phiếu {shape, weight} (strong=2, mild=1). research §4a.
type Vote = Partial<Record<BodyShape, number>>;
const VOTE_TABLE: Record<string, Record<string, Vote>> = {
  q1_gain: {
    allover: { rectangle: 2 }, hips: { pear: 2 }, belly: { apple: 2 },
    bust: { invertedTriangle: 2 }, bustHips: { hourglass: 2 },
  },
  q2_widest: {
    shoulders: { invertedTriangle: 2 }, hips: { pear: 2 },
    same: { rectangle: 1, hourglass: 1, apple: 1 }, waist: { apple: 2 },
  },
  q3_waist: {
    sharp: { hourglass: 2, pear: 1, invertedTriangle: 1 },
    slight: { rectangle: 2 }, wider: { apple: 2 },
  },
  q4_shoulders: {
    shoulders: { invertedTriangle: 2 }, hips: { pear: 2 },
    balanced: { hourglass: 1, rectangle: 1, apple: 1 },
  },
  q5_gainwaist: {
    defined: { hourglass: 1, pear: 1 }, thickens: { apple: 2, rectangle: 1 },
  },
};

export interface BodyAnswers {
  q1_gain?: string; q2_widest?: string; q3_waist?: string; q4_shoulders?: string; q5_gainwaist?: string;
  measurements?: Measurements;
  heightCm?: number;
  proportion?: Proportion;
}

export function voteBodyShape(a: BodyAnswers): { shape: BodyShape; secondary: BodyShape | null; confidence: number } {
  const score: Record<BodyShape, number> = { hourglass: 0, pear: 0, apple: 0, rectangle: 0, invertedTriangle: 0 };
  let total = 0;
  for (const [q, sel] of Object.entries(VOTE_TABLE)) {
    const id = (a as Record<string, string | undefined>)[q];
    if (!id || !sel[id]) continue;
    for (const [shape, w] of Object.entries(sel[id])) { score[shape as BodyShape] += w!; total += w!; }
  }
  const ranked = BODY_SHAPES.map((s) => ({ s, v: score[s] })).sort((x, y) => y.v - x.v || BODY_SHAPES.indexOf(x.s) - BODY_SHAPES.indexOf(y.s));
  let shape = ranked[0].s;

  // GUARDS (research §4b): eo-dominant quyết định apple; balance + waist rõ/thẳng.
  if (a.q3_waist === 'wider' || a.q2_widest === 'waist') shape = 'apple';
  else if (a.q3_waist === 'sharp' && a.q4_shoulders === 'balanced') shape = 'hourglass';
  else if (a.q3_waist === 'slight' && a.q4_shoulders === 'balanced') shape = 'rectangle';

  const secondary = ranked.find((r) => r.s !== shape && r.v > 0)?.s ?? null;
  const secondaryVal = secondary ? score[secondary] : 0;
  const confidence = total > 0 ? (score[shape] - secondaryVal) / total : 0;
  return { shape, secondary, confidence };
}

function heightBand(cm?: number): HeightBand {
  if (typeof cm !== 'number') return 'regular';
  if (cm < 163) return 'petite';
  if (cm > 173) return 'tall';
  return 'regular';
}

/** Số đo (nếu có) override vote. Luôn kèm height/proportion modifier (trực giao). */
export function deriveBodyShape(a: BodyAnswers, opts?: { refined?: boolean }): BodyResult {
  const heightMod = { heightBand: heightBand(a.heightCm), proportion: a.proportion ?? 'balanced' as Proportion };
  if (a.measurements) {
    const shape = classifyFFIT(a.measurements);
    return { shape, secondary: null, confidence: 'refined', ...heightMod, fromMeasurements: true };
  }
  const v = voteBodyShape(a);
  const answered = ['q1_gain', 'q2_widest', 'q3_waist', 'q4_shoulders', 'q5_gainwaist'].filter((q) => (a as Record<string, unknown>)[q] != null).length;
  const confidence: 'coarse' | 'refined' = opts?.refined === true && answered >= 4 && v.confidence >= 0.15 ? 'refined' : 'coarse';
  return { shape: v.shape, secondary: v.secondary, confidence, ...heightMod, fromMeasurements: false };
}
