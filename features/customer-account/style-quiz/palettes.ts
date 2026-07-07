/**
 * 12-season color palettes (Sci\ART / Color Me Beautiful lineage). Xem spec
 * 2026-07-08-style-quiz-design §0,§2 + scratchpad/research-color.md.
 *
 * CREDIBILITY: hệ 12-season là CONVENTION image-consulting (không validate khoa
 * học). HEX là XẤP XỈ [A] — designer cần duyệt/chỉnh (giữ ở đây để sửa 1 chỗ).
 * `dominant` = trục Munsell định nghĩa sub-season đó (dùng cho tên + sister).
 */

export const SEASONS = [
  'Bright Winter', 'True Winter', 'Deep Winter',
  'Light Summer', 'True Summer', 'Soft Summer',
  'Soft Autumn', 'True Autumn', 'Deep Autumn',
  'Light Spring', 'True Spring', 'Bright Spring',
] as const;
export type Season = (typeof SEASONS)[number];
export type SeasonFamily = 'Winter' | 'Summer' | 'Autumn' | 'Spring';
export type Temperature = 'warm' | 'cool' | 'neutral';
export type MunsellAxis = 'hue' | 'value' | 'chroma';

export interface SeasonPalette {
  family: SeasonFamily;
  temperature: Temperature;
  /** Trục dominant định nghĩa sub-season (Bright→chroma, Deep→value, True→hue). */
  dominant: MunsellAxis;
  wear: string[];
  avoid: string[];
}

export const SEASON_PALETTES: Record<Season, SeasonPalette> = {
  'Bright Winter': { family: 'Winter', temperature: 'cool', dominant: 'chroma',
    wear: ['#E00A2E', '#D6187C', '#00875A', '#1560E8', '#00B5C7', '#0A3AC8', '#7A1FA2', '#F3F16A', '#FFFFFF', '#111111', '#F7C6D9', '#8FD400'],
    avoid: ['#C9A0A6', '#C19A6B', '#808000', '#D8C3A5', '#B7410E', '#6B4423'] },
  'True Winter': { family: 'Winter', temperature: 'cool', dominant: 'hue',
    wear: ['#C8102E', '#C71585', '#00674B', '#153FBF', '#0F52BA', '#BEE0F0', '#F5C4D6', '#FFFFFF', '#0F0F0F', '#8A8D8F', '#6E2C91', '#2A6FDB'],
    avoid: ['#FF7A1A', '#D4A017', '#E2543B', '#D8C3A5', '#8A9A5B', '#D4AF37'] },
  'Deep Winter': { family: 'Winter', temperature: 'neutral', dominant: 'value',
    wear: ['#0E0E0E', '#2B2B2B', '#5C0A2E', '#0B3D2E', '#0C1B3A', '#C20017', '#3E1F47', '#00694A', '#F3C3D4', '#FFFFFF', '#12369E', '#0A4A55'],
    avoid: ['#FFCBA4', '#C19A6B', '#D4A017', '#FF7A1A', '#D9C09A', '#C56A45'] },
  'Light Summer': { family: 'Summer', temperature: 'cool', dominant: 'value',
    wear: ['#AEC6E4', '#C7BCE0', '#E7A9B8', '#8C9FE0', '#C4C7CC', '#B7C9AE', '#B8E0D2', '#7C9CC4', '#F3CAD6', '#AEDAD4', '#C7A9C9', '#F4F3EE'],
    avoid: ['#111111', '#FF7A1A', '#B7410E', '#D4A017', '#E2402A', '#6B4423'] },
  'True Summer': { family: 'Summer', temperature: 'cool', dominant: 'hue',
    wear: ['#C48A98', '#4C8C8C', '#7E93A8', '#A63A5B', '#A88397', '#7A5C57', '#33456B', '#5C6E96', '#3E6B63', '#9C6B6B', '#7A2E43', '#F2F0EA'],
    avoid: ['#FF7A1A', '#D4AF37', '#F2D024', '#B7410E', '#D96A2B', '#D8C3A5'] },
  'Soft Summer': { family: 'Summer', temperature: 'neutral', dominant: 'chroma',
    wear: ['#9FAE93', '#8FA3B3', '#8A6E86', '#A79E92', '#C39098', '#6E7A82', '#5E8384', '#7C6A64', '#A98FA0', '#8C8F92', '#B6A6C0', '#7FA093'],
    avoid: ['#000000', '#FFFFFF', '#39FF14', '#FF7A1A', '#FF1493', '#D4AF37'] },
  'Soft Autumn': { family: 'Autumn', temperature: 'neutral', dominant: 'chroma',
    wear: ['#C19A6B', '#B49E86', '#C98A6E', '#C98F86', '#5E8481', '#8A8B5A', '#A6A667', '#E29A82', '#D9C29A', '#B96A4C', '#7E8654', '#F1E7D2'],
    avoid: ['#F5C4D6', '#FF1493', '#0A3AC8', '#FFFFFF', '#39FF14', '#8A8D8F'] },
  'True Autumn': { family: 'Autumn', temperature: 'warm', dominant: 'hue',
    wear: ['#C05A21', '#6B7328', '#A8401C', '#C79A2E', '#6B4423', '#0E6B6B', '#D96A2B', '#D4A017', '#B85C38', '#2E5E3A', '#9C6B30', '#F1E7D2'],
    avoid: ['#BEE0F0', '#F5C4D6', '#FFFFFF', '#B7BCC0', '#FF1493', '#111111'] },
  'Deep Autumn': { family: 'Autumn', temperature: 'warm', dominant: 'value',
    wear: ['#3E2A20', '#4E5223', '#6E1E28', '#9C4A24', '#0C4A4A', '#8A5A22', '#243E24', '#3E2436', '#8A3316', '#C08A18', '#C25A22', '#EDE0C6'],
    avoid: ['#F5C4D6', '#D8CBE8', '#BEE0F0', '#8A8D8F', '#39FF14', '#E7D8DE'] },
  'Light Spring': { family: 'Spring', temperature: 'warm', dominant: 'value',
    wear: ['#FFCBA4', '#F58F7C', '#B6E3C6', '#F6E27A', '#A9E0DD', '#F5ECD6', '#F7B8B0', '#F7A86B', '#E8C79A', '#9FD0EE', '#C7E06A', '#F79E8E'],
    avoid: ['#111111', '#2B2B2B', '#5C0A2E', '#0C1B3A', '#C9A0A6', '#BEE0F0'] },
  'True Spring': { family: 'Spring', temperature: 'warm', dominant: 'hue',
    wear: ['#F76E4C', '#F5C518', '#4F9E3E', '#12BFB0', '#FBA76A', '#E8452B', '#F47F5E', '#E0A81E', '#2FC5C0', '#FF8A3C', '#6E8CE0', '#F5ECD6'],
    avoid: ['#111111', '#8A8D8F', '#BEE0F0', '#CBD3DA', '#5C0A2E', '#A88397'] },
  'Bright Spring': { family: 'Spring', temperature: 'neutral', dominant: 'chroma',
    wear: ['#FF5C3C', '#E8172E', '#12C7C0', '#00C2D1', '#FF4FA3', '#F7C400', '#00A15C', '#5A7CF0', '#3FBF4F', '#E63CA0', '#FF8A00', '#F6EFDA'],
    avoid: ['#B49E86', '#8C8072', '#E7D8DE', '#111111', '#D8C3A5', '#808000'] },
};

/** (family, trục dominant) → tên sub-season. */
export const SEASON_BY_FAMILY_AXIS: Record<SeasonFamily, Record<MunsellAxis, Season>> = {
  Winter: { hue: 'True Winter', value: 'Deep Winter', chroma: 'Bright Winter' },
  Summer: { hue: 'True Summer', value: 'Light Summer', chroma: 'Soft Summer' },
  Autumn: { hue: 'True Autumn', value: 'Deep Autumn', chroma: 'Soft Autumn' },
  Spring: { hue: 'True Spring', value: 'Light Spring', chroma: 'Bright Spring' },
};

/** Collapse 12 → 4-season (kết quả coarse ở Level 1). */
export function to4Season(season: Season): SeasonFamily {
  return SEASON_PALETTES[season].family;
}

/** Sister season = cùng trait dominant, khác nhiệt độ (warm↔cool). Dùng làm
 *  fallback khi hue trung tính/độ tin thấp (neutral/olive). True-season (dominant
 *  = hue) KHÔNG có sister vì chính nhiệt độ định nghĩa nó. */
export const SISTER_SEASON: Partial<Record<Season, Season>> = {
  'Bright Winter': 'Bright Spring', 'Bright Spring': 'Bright Winter',
  'Deep Winter': 'Deep Autumn', 'Deep Autumn': 'Deep Winter',
  'Light Summer': 'Light Spring', 'Light Spring': 'Light Summer',
  'Soft Summer': 'Soft Autumn', 'Soft Autumn': 'Soft Summer',
};
