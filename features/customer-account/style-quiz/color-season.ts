/**
 * THUẦN: chấm điểm câu trả lời màu → 3 axis Munsell → 12-season.
 * Xem spec §2 + scratchpad/research-color.md. Không I/O.
 *
 * CREDIBILITY: hệ 12-season là convention; chỉ luật thô "ấm↔ấm, lạnh↔lạnh, khớp
 * độ sâu" có bằng chứng. UI phải trình bày là gợi ý, không phải chẩn đoán.
 */
import {
  type Season, type SeasonFamily, type Temperature,
  SEASON_PALETTES, SEASON_BY_FAMILY_AXIS, SISTER_SEASON,
} from './palettes';

/** Mỗi câu trả lời là số [-1,1]. Dấu theo research (xem tên nhóm). */
export interface ColorAnswers {
  // HUE: +warm / -cool
  whiteVsCream?: number; jewelry?: number; eyesHair?: number; sun?: number; vein?: number;
  // VALUE: +deep / -light
  skinDepth?: number; hairDepth?: number; overall?: number;
  // CHROMA: +bright / -soft
  vividVsDusty?: number; eyesClearSoft?: number; contrast?: number;
}

export interface ColorAxes {
  hue: number; value: number; chroma: number;
  contrastLevel: 'low' | 'medium' | 'high';
}

export interface ColorResult {
  season: Season;
  family: SeasonFamily;
  temperature: Temperature;
  palette: string[];
  avoid: string[];
  confidence: 'coarse' | 'refined';
  /** Season chị-em khi hue trung tính (olive/mập mờ) — trình cả 2 cho khách. */
  sisterFallback: Season | null;
}

// Trọng số theo độ tin cậy của từng test (research §5): white-vs-cream & jewelry
// cao nhất, vein thấp nhất.
const HUE_W: Record<string, number> = { whiteVsCream: 0.30, jewelry: 0.25, eyesHair: 0.20, sun: 0.15, vein: 0.10 };
const VALUE_W: Record<string, number> = { skinDepth: 0.45, hairDepth: 0.35, overall: 0.20 };
const CHROMA_W: Record<string, number> = { vividVsDusty: 0.40, eyesClearSoft: 0.35, contrast: 0.25 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Trung bình có trọng số CHỈ trên câu đã trả lời (renormalize) — câu thiếu
 *  không kéo điểm về 0. */
function weightedAxis(a: ColorAnswers, weights: Record<string, number>): number {
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = (a as Record<string, number | undefined>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) { num += clamp(v, -1, 1) * w; den += w; }
  }
  return den > 0 ? num / den : 0;
}

export function scoreColorAxes(a: ColorAnswers): ColorAxes {
  const hue = weightedAxis(a, HUE_W);
  const value = weightedAxis(a, VALUE_W);
  const chroma = weightedAxis(a, CHROMA_W);
  const c = typeof a.contrast === 'number' ? a.contrast : 0;
  const contrastLevel = c >= 0.34 ? 'high' : c <= -0.34 ? 'low' : 'medium';
  return { hue, value, chroma, contrastLevel };
}

const T = 0.34; // ngưỡng bucket warm/cool·deep/light·bright/soft

export function deriveColorSeason(axes: ColorAxes, opts?: { refined?: boolean }): ColorResult {
  const { hue, value, chroma } = axes;

  // 1) family
  let family: SeasonFamily;
  if (hue >= T) {
    family = value - chroma > 0 ? 'Autumn' : 'Spring'; // warm: deep+soft→Autumn, light+bright→Spring
  } else if (hue <= -T) {
    family = value + chroma > 0 ? 'Winter' : 'Summer'; // cool: deep+bright→Winter, light+soft→Summer
  } else {
    // hue trung tính → quyết theo trục value/chroma mạnh hơn
    if (Math.abs(value) >= Math.abs(chroma)) {
      family = value >= 0 ? (chroma >= 0 ? 'Winter' : 'Autumn') : (chroma >= 0 ? 'Spring' : 'Summer');
    } else {
      family = chroma >= 0 ? (value >= 0 ? 'Winter' : 'Spring') : (value >= 0 ? 'Autumn' : 'Summer');
    }
  }

  // 2) dominant axis → sub-season
  const mag = { hue: Math.abs(hue), value: Math.abs(value), chroma: Math.abs(chroma) };
  const dominant = (['hue', 'value', 'chroma'] as const).reduce((a, b) => (mag[b] > mag[a] ? b : a));
  const season = SEASON_BY_FAMILY_AXIS[family][dominant];
  const pal = SEASON_PALETTES[season];

  // 3) confidence + sister fallback
  const maxMag = Math.max(mag.hue, mag.value, mag.chroma);
  const hueNeutral = Math.abs(hue) < T;
  const lowConfidence = maxMag < T || hueNeutral;
  const confidence: 'coarse' | 'refined' = opts?.refined === true && !lowConfidence ? 'refined' : 'coarse';
  const sisterFallback = hueNeutral ? SISTER_SEASON[season] ?? null : null;

  return {
    season, family, temperature: pal.temperature,
    palette: pal.wear, avoid: pal.avoid, confidence, sisterFallback,
  };
}
