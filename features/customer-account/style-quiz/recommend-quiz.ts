/**
 * THUẦN: StyleProfile + catalog → sản phẩm gợi ý (score + rank đa dạng).
 * research-quiz.md Part 2b,2c. NƠI tính điểm gợi ý theo quiz (khác recommend.ts
 * của wishlist — kia là overlap seed, đây là 3-trục profile).
 *
 * Nguyên tắc: thuộc tính KHÔNG biết = 0.5 tại NỬA trọng số (không phạt như sai).
 * Rank = MMR (λ) + cap mỗi category (chống dồn 1 loại). SOFT — không hard-filter.
 */
import type { CatalogProduct } from '../recommend';
import type { StyleProfile } from './profile';
import { extractProductAttributes, type ProductAttributes } from './extract';
import { BODY_RULES } from './body-rules';
import { to4Season } from './palettes';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const some = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** [0,1] hoặc null (không biết màu). */
export function colorScore(profile: StyleProfile, attrs: ProductAttributes): number | null {
  if (!attrs.colorFamilies) return null;
  const fam = to4Season(profile.color.season);
  if (attrs.colorFamilies.includes(fam)) return 0.9;
  const t = profile.color.temperature;
  if (t !== 'neutral' && attrs.colorTemps?.includes(t)) return 0.55;
  return 0.35;
}

export function bodyScore(profile: StyleProfile, attrs: ProductAttributes): number | null {
  const known = attrs.necklines.length || attrs.silhouettes.length || attrs.fits.length || attrs.features.length;
  if (!known) return null;
  const r = BODY_RULES[profile.body.shape];
  let s = 0.5;
  if (attrs.necklines.length) {
    if (some(attrs.necklines, r.goodNecklines)) s += 0.25;
    if (some(attrs.necklines, r.avoidNecklines)) s -= 0.2;
  }
  if (attrs.silhouettes.length) {
    if (some(attrs.silhouettes, r.goodSilhouettes)) s += 0.25;
    if (some(attrs.silhouettes, r.avoidSilhouettes)) s -= 0.2;
  }
  if (attrs.fits.length && some(attrs.fits, r.goodFits)) s += 0.1;
  if (attrs.features.length) {
    if (some(attrs.features, r.goodFeatures)) s += 0.15;
    if (some(attrs.features, r.avoidFeatures)) s -= 0.1;
  }
  return clamp01(s);
}

export function archetypeScore(profile: StyleProfile, attrs: ProductAttributes): number | null {
  if (!attrs.moods) return null;
  const wanted = new Set([profile.archetype.primary, ...(profile.archetype.secondary ? [profile.archetype.secondary] : [])]);
  const hits = attrs.moods.filter((m) => wanted.has(m)).length;
  return hits > 0 ? Math.min(1, 0.7 + 0.3 * hits) : 0.3; // soft, không zero
}

const WEIGHTS = { color: 0.40, body: 0.30, archetype: 0.30 };
const UNKNOWN = 0.5, UNKNOWN_WEIGHT = 0.5;

export function scoreProduct(profile: StyleProfile, attrs: ProductAttributes): number {
  const parts: Array<[number | null, number]> = [
    [colorScore(profile, attrs), WEIGHTS.color],
    [bodyScore(profile, attrs), WEIGHTS.body],
    [archetypeScore(profile, attrs), WEIGHTS.archetype],
  ];
  let num = 0, den = 0;
  for (const [raw, w] of parts) {
    const value = raw === null ? UNKNOWN : raw;
    const weight = raw === null ? w * UNKNOWN_WEIGHT : w;
    num += value * weight; den += weight;
  }
  return den > 0 ? num / den : UNKNOWN;
}

export interface ScoredQuizProduct extends CatalogProduct {
  score: number;
  attrs: ProductAttributes;
  reasons: string[];
}

function reasonsFor(profile: StyleProfile, attrs: ProductAttributes): string[] {
  const out: string[] = [];
  const c = colorScore(profile, attrs); if (c !== null && c >= 0.85) out.push('trong bảng màu của bạn');
  const b = bodyScore(profile, attrs); if (b !== null && b >= 0.7) out.push('tôn dáng của bạn');
  const a = archetypeScore(profile, attrs); if (a !== null && a >= 0.7) out.push('hợp gu của bạn');
  return out;
}

function similarity(a: ScoredQuizProduct, b: ScoredQuizProduct): number {
  let s = 0;
  if (a.attrs.category && a.attrs.category === b.attrs.category) s += 0.7;
  if (a.vendor && a.vendor === b.vendor) s += 0.15;
  if (a.attrs.colorFamilies && b.attrs.colorFamilies && some(a.attrs.colorFamilies, b.attrs.colorFamilies)) s += 0.15;
  return clamp01(s);
}

export interface RecommendOptions { topN?: number; lambda?: number; excludeProductIds?: string[]; }

export function recommendForProfile(
  profile: StyleProfile,
  candidates: CatalogProduct[],
  opts: RecommendOptions = {},
): ScoredQuizProduct[] {
  const topN = opts.topN ?? 24;
  const lambda = opts.lambda ?? 0.7;
  const exclude = new Set(opts.excludeProductIds ?? []);

  const scored: ScoredQuizProduct[] = [];
  for (const c of candidates) {
    if (exclude.has(c.shopifyProductId)) continue;
    if (!c.availableForSale || c.status !== 'ACTIVE') continue;
    const attrs = extractProductAttributes(c);
    scored.push({ ...c, attrs, score: scoreProduct(profile, attrs), reasons: reasonsFor(profile, attrs) });
  }
  scored.sort((x, y) => y.score - x.score || y.syncedAt.getTime() - x.syncedAt.getTime());

  // MMR greedy + cap mỗi category
  const perCatCap = Math.max(1, Math.ceil(topN / 4));
  const remaining = [...scored];
  const selected: ScoredQuizProduct[] = [];
  const catCount = new Map<string, number>();
  while (selected.length < topN && remaining.length) {
    let bestIdx = -1, bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const cat = cand.attrs.category ?? 'unknown';
      if ((catCount.get(cat) ?? 0) >= perCatCap) continue;
      const maxSim = selected.length ? Math.max(...selected.map((s) => similarity(cand, s))) : 0;
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestVal) { bestVal = mmr; bestIdx = i; }
    }
    if (bestIdx === -1) break; // mọi category đã đạt cap
    const [picked] = remaining.splice(bestIdx, 1);
    selected.push(picked);
    const cat = picked.attrs.category ?? 'unknown';
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
  }
  return selected;
}
