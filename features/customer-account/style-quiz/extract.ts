/**
 * THUẦN: sản phẩm (title+type+tags) → thuộc tính suy luận. Miss → null (không
 * đoán bừa; recommender xử lý null = trung tính). research-quiz.md Part 2a.
 * Nên cache theo product.syncedAt (extraction là text thuần).
 */
import type { CatalogProduct } from '../recommend';
import type { SeasonFamily } from './palettes';
import type { Archetype } from './archetype';
import {
  type Category, type ColorTemp,
  CATEGORY_KEYWORDS, NECKLINE_KEYWORDS, SILHOUETTE_KEYWORDS, FIT_KEYWORDS, FEATURE_KEYWORDS, MOOD_KEYWORDS,
  COLOR_ALIASES, CANONICAL_COLOR,
} from './dictionaries';
import { ARCHETYPES } from './archetype';

export interface ProductAttributes {
  category: Category | null;
  colorFamilies: SeasonFamily[] | null;
  colorTemps: ColorTemp[] | null;
  necklines: string[];
  silhouettes: string[];
  fits: string[];
  features: string[];
  moods: Archetype[] | null;
}

function blobOf(p: CatalogProduct): string {
  return [p.title, p.productType ?? '', ...(p.tags ?? [])].join(' ').toLowerCase();
}

/** Trả các key của dict mà blob khớp bất kỳ keyword. */
function matchKeys(blob: string, dict: Record<string, string[]>): string[] {
  const hits: string[] = [];
  for (const [key, words] of Object.entries(dict)) {
    if (words.some((w) => blob.includes(w))) hits.push(key);
  }
  return hits;
}

export function extractProductAttributes(p: CatalogProduct): ProductAttributes {
  const blob = blobOf(p);

  // category: keyword match; fallback productType
  const catHits = (Object.keys(CATEGORY_KEYWORDS) as Category[]).filter((c) => CATEGORY_KEYWORDS[c].some((w) => blob.includes(w)));
  const category: Category | null = catHits[0] ?? null;

  // colors → families + temps
  const fams = new Set<SeasonFamily>();
  const temps = new Set<ColorTemp>();
  let foundColor = false;
  for (const [alias, canon] of Object.entries(COLOR_ALIASES)) {
    if (blob.includes(alias)) {
      const info = CANONICAL_COLOR[canon];
      if (info) { foundColor = true; info.families.forEach((f) => fams.add(f)); temps.add(info.temperature); }
    }
  }

  const necklines = matchKeys(blob, NECKLINE_KEYWORDS);
  const silhouettes = matchKeys(blob, SILHOUETTE_KEYWORDS);
  const fits = matchKeys(blob, FIT_KEYWORDS);
  const features = matchKeys(blob, FEATURE_KEYWORDS);

  const moodHits = ARCHETYPES.filter((a) => MOOD_KEYWORDS[a].some((w) => blob.includes(w)));

  return {
    category,
    colorFamilies: foundColor ? [...fams] : null,
    colorTemps: foundColor ? [...temps] : null,
    necklines, silhouettes, fits, features,
    moods: moodHits.length > 0 ? moodHits : null,
  };
}
