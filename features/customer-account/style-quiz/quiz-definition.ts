/**
 * THUẦN: định nghĩa câu hỏi quiz (3 trục, theo level) cho UI/API + hàm gộp câu
 * trả lời thô → QuizAnswers. Xem spec §5. Câu hỏi giữ trong code (v1).
 */
import { ARCHETYPE_QUESTIONS } from './archetype';
import type { QuizAnswers } from './profile';
import type { Proportion } from './body-shape';

export type QuizAxis = 'color' | 'body' | 'archetype';
export interface QuizUIOption { value: string; label: string; swatch?: string }
export interface QuizUIQuestion {
  axis: QuizAxis;
  id: string;
  prompt: string;
  type: 'image' | 'text' | 'slider' | 'swatch';
  level: 1 | 2;
  /** field trong ColorAnswers/BodyAnswers (color/body); archetype dùng id trực tiếp. */
  field?: string;
  options: QuizUIOption[];
}

// ── Câu hỏi MÀU (value = số signed để map vào ColorAnswers) ──
const COLOR_QUESTIONS: QuizUIQuestion[] = [
  { axis: 'color', id: 'c_jewelry', field: 'jewelry', type: 'swatch', level: 1,
    prompt: 'Trang sức nào tôn da bạn hơn?', options: [
      { value: '1', label: 'Vàng' }, { value: '-1', label: 'Bạc' }, { value: '0', label: 'Cả hai đều hợp' }] },
  { axis: 'color', id: 'c_white', field: 'whiteVsCream', type: 'swatch', level: 1,
    prompt: 'Áo trắng tinh hay trắng kem hợp da bạn hơn?', options: [
      { value: '-1', label: 'Trắng tinh', swatch: '#FFFFFF' }, { value: '1', label: 'Trắng kem', swatch: '#F1E7D2' }, { value: '0', label: 'Như nhau' }] },
  { axis: 'color', id: 'c_depth', field: 'skinDepth', type: 'text', level: 1,
    prompt: 'Tông màu tổng thể (da+tóc+mắt) của bạn?', options: [
      { value: '-1', label: 'Sáng, nhẹ' }, { value: '0', label: 'Trung bình' }, { value: '1', label: 'Sâu, đậm' }] },
  { axis: 'color', id: 'c_eyeshair', field: 'eyesHair', type: 'text', level: 1,
    prompt: 'Mắt & tóc tự nhiên của bạn thiên về?', options: [
      { value: '1', label: 'Ấm (nâu vàng, hạt dẻ, olive)' }, { value: '-1', label: 'Lạnh (đen, xám, xanh)' }, { value: '0', label: 'Khó nói' }] },
  { axis: 'color', id: 'c_chroma', field: 'vividVsDusty', type: 'swatch', level: 2,
    prompt: 'Bảng màu nào làm mặt bạn "bừng sáng"?', options: [
      { value: '1', label: 'Rực rỡ, trong trẻo' }, { value: '-1', label: 'Trầm, phủ bụi (muted)' }] },
  { axis: 'color', id: 'c_contrast', field: 'contrast', type: 'text', level: 2,
    prompt: 'Độ tương phản giữa tóc – da – mắt của bạn?', options: [
      { value: '1', label: 'Cao (vd tóc đen, da sáng)' }, { value: '0', label: 'Trung bình' }, { value: '-1', label: 'Thấp (các tông gần nhau)' }] },
];

// ── Câu hỏi DÁNG (value = option id map vào BodyAnswers) ──
const BODY_QUESTIONS: QuizUIQuestion[] = [
  { axis: 'body', id: 'q1_gain', field: 'q1_gain', type: 'image', level: 1,
    prompt: 'Bạn tăng cân đầu tiên ở đâu?', options: [
      { value: 'allover', label: 'Đều khắp / bụng phẳng' }, { value: 'hips', label: 'Hông, đùi, mông' },
      { value: 'belly', label: 'Bụng/eo, chân vẫn thon' }, { value: 'bust', label: 'Ngực, lưng trên, tay' },
      { value: 'bustHips', label: 'Ngực & hông đều, eo vẫn nhỏ' }] },
  { axis: 'body', id: 'q2_widest', field: 'q2_widest', type: 'image', level: 1,
    prompt: 'Đứng thẳng, phần nào rộng nhất?', options: [
      { value: 'shoulders', label: 'Vai/ngực' }, { value: 'hips', label: 'Hông' },
      { value: 'same', label: 'Khá cân bằng' }, { value: 'waist', label: 'Eo/giữa người' }] },
  { axis: 'body', id: 'q3_waist', field: 'q3_waist', type: 'image', level: 1,
    prompt: 'Eo của bạn?', options: [
      { value: 'sharp', label: 'Hóp rõ, nhỏ hơn hẳn ngực & hông' }, { value: 'slight', label: 'Chỉ nhỏ hơn chút / khá thẳng' },
      { value: 'wider', label: 'Bằng hoặc rộng hơn ngực/hông' }] },
  { axis: 'body', id: 'q4_shoulders', field: 'q4_shoulders', type: 'image', level: 2,
    prompt: 'Vai so với hông, bên nào trông rộng hơn?', options: [
      { value: 'shoulders', label: 'Vai rộng hơn' }, { value: 'hips', label: 'Hông rộng hơn' }, { value: 'balanced', label: 'Cân bằng' }] },
  { axis: 'body', id: 'q5_gainwaist', field: 'q5_gainwaist', type: 'image', level: 2,
    prompt: 'Khi tăng cân, eo bạn?', options: [
      { value: 'defined', label: 'Vẫn giữ đường eo' }, { value: 'thickens', label: 'Dày lên / mờ đi' }] },
];

/** Toàn bộ câu hỏi 3 trục (archetype lấy từ ARCHETYPE_QUESTIONS). */
export const QUIZ_QUESTIONS: QuizUIQuestion[] = [
  ...COLOR_QUESTIONS,
  ...BODY_QUESTIONS,
  ...ARCHETYPE_QUESTIONS.map((q): QuizUIQuestion => ({
    axis: 'archetype', id: q.id, prompt: q.prompt,
    type: q.type === 'slider' ? 'slider' : 'image', level: q.level,
    options: q.options.map((o) => ({ value: o.id, label: o.label })),
  })),
];

export interface OptionalBodyExtras { heightCm?: number; proportion?: Proportion }

/**
 * Gộp lựa chọn thô (questionId → value) thành QuizAnswers cho deriveProfile.
 * color: value → số; body: value → option id; archetype: value → option id.
 */
export function assembleAnswers(
  raw: Record<string, string>,
  extras: OptionalBodyExtras = {},
): QuizAnswers {
  const color: Record<string, number> = {};
  const body: Record<string, string> = {};
  const archetype: Record<string, string> = {};

  for (const q of QUIZ_QUESTIONS) {
    const v = raw[q.id];
    if (v == null || v === '') continue;
    if (q.axis === 'color' && q.field) color[q.field] = Number(v);
    else if (q.axis === 'body' && q.field) body[q.field] = v;
    else if (q.axis === 'archetype') archetype[q.id] = v;
  }

  return {
    color: color as QuizAnswers['color'],
    archetype,
    body: { ...(body as Record<string, string>), heightCm: extras.heightCm, proportion: extras.proportion } as QuizAnswers['body'],
  };
}
