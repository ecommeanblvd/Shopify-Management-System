/**
 * THUẦN: từ điển suy thuộc tính sản phẩm (màu/category/silhouette/mood) từ text.
 * Xem spec §6 + research-quiz.md Part 2. Dựa trên data thật cici (a-line, v-neck,
 * off-shoulder, peplum, sweetheart, halter... trong title; màu trong tags).
 * Miss → null (KHÔNG đoán bừa). Có thể chuyển sang bảng config để merchandiser sửa.
 */
import type { SeasonFamily } from './palettes';
import type { Archetype } from './archetype';

/** Category chuẩn (khớp research recommender). */
export type Category = 'dress' | 'top' | 'bottom' | 'outerwear' | 'footwear' | 'accessory';

export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  dress: ['dress', 'gown', 'maxi dress', 'midi dress', 'mini dress', 'ao dai', 'jumpsuit', 'romper', 'bodysuit', 'set', 'co-ord', 'coord'],
  top: ['top', 'blouse', 'shirt', 'tee', 'tank', 'cami', 'camisole', 'sweater', 'knit', 'cardigan', 'crop'],
  bottom: ['pant', 'trouser', 'jean', 'short', 'skirt', 'skort', 'legging', 'culotte'],
  outerwear: ['coat', 'jacket', 'blazer', 'trench', 'cape', 'parka', 'puffer', 'vest', 'gilet'],
  footwear: ['shoe', 'boot', 'heel', 'sneaker', 'sandal', 'loafer', 'flat', 'pump'],
  accessory: ['bag', 'belt', 'scarf', 'hat', 'brooch', 'glove', 'earring', 'necklace', 'headband', 'hair'],
};

/** Neckline từ title (controlled vocab). */
export const NECKLINE_KEYWORDS: Record<string, string[]> = {
  v_neck: ['v-neck', 'v neck', 'plunge', 'deep-v', 'surplice'],
  scoop: ['scoop', 'u-neck'],
  sweetheart: ['sweetheart'],
  square: ['square neck', 'square-neck'],
  halter: ['halter'],
  off_shoulder: ['off-shoulder', 'off shoulder', 'one shoulder', 'one-shoulder'],
  boat: ['boat', 'bateau', 'off-the-shoulder'],
  cowl: ['cowl'],
  jewel: ['crew', 'jewel', 'round neck', 'high neck', 'turtleneck', 'mock neck'],
  strapless: ['strapless', 'tube', 'bandeau'],
};

/** Silhouette + fit từ title/type. */
export const SILHOUETTE_KEYWORDS: Record<string, string[]> = {
  fit_and_flare: ['fit and flare', 'fit-and-flare', 'babydoll', 'skater'],
  wrap: ['wrap'],
  a_line: ['a-line', 'a line'],
  shift: ['shift'],
  bodycon: ['bodycon', 'bandage', 'bodysuit'],
  peplum: ['peplum'],
  empire: ['empire'],
  column: ['column', 'sheath'],
  mermaid: ['mermaid', 'trumpet', 'fishtail'],
  pencil: ['pencil'],
  pleated: ['pleated', 'pleat'],
};

export const FIT_KEYWORDS: Record<string, string[]> = {
  fitted: ['fitted', 'bodycon', 'slim', 'tailored', 'pencil', 'bandage'],
  relaxed: ['relaxed', 'oversized', 'loose', 'flowy', 'a-line', 'babydoll', 'wide'],
  structured: ['structured', 'blazer', 'tailored', 'boxy', 'ponte'],
};

/** Feature (đường/chi tiết) hỗ trợ body-shape matching. */
export const FEATURE_KEYWORDS: Record<string, string[]> = {
  waist_defining: ['belted', 'belt', 'wrap', 'peplum', 'fit and flare', 'fit-and-flare', 'cinched', 'corset', 'tie-waist'],
  high_waist: ['high waist', 'high-waist', 'high-rise', 'high rise'],
  puff_sleeve: ['puff', 'balloon sleeve', 'bishop'],
  ruffle: ['ruffle', 'frill', 'flounce'],
  vertical: ['column', 'longline', 'maxi'],
  full_skirt: ['full skirt', 'circle skirt', 'tiered', 'flare'],
  off_shoulder: ['off-shoulder', 'off shoulder', 'strapless'],
  crop: ['crop', 'cropped'],
};

/** Mood → archetype (từ khoá phong cách). */
export const MOOD_KEYWORDS: Record<Archetype, string[]> = {
  classic: ['classic', 'timeless', 'tailored', 'blazer', 'shirt', 'trench', 'sheath', 'office', 'minimal'],
  dramatic: ['bold', 'statement', 'sequin', 'column', 'bodycon', 'sleek', 'structured', 'sharp'],
  romantic: ['floral', 'lace', 'ruffle', 'sweetheart', 'bow', 'tulle', 'chiffon', 'babydoll', 'peplum', 'delicate', 'pastel'],
  natural: ['linen', 'denim', 'knit', 'cotton', 'relaxed', 'casual', 'jumpsuit'],
  creative: ['print', 'embroidered', 'paisley', 'boho', 'crochet', 'velvet', 'asymmetric', 'mixed', 'artistic'],
  edgy: ['leather', 'moto', 'utility', 'cargo', 'graphic', 'coated', 'studded', 'cut-out', 'cutout'],
};

/**
 * Màu (canonical) → nhiệt độ + họ mùa phù hợp. Tra 2 bước: word→canonical (alias)
 * rồi canonical→{temperature, families}. Convention [C], HEX/mapping là gần đúng.
 */
export type ColorTemp = 'warm' | 'cool' | 'neutral';
export const COLOR_ALIASES: Record<string, string> = {
  navy: 'navy', midnight: 'navy', ink: 'navy',
  burgundy: 'burgundy', wine: 'burgundy', maroon: 'burgundy', oxblood: 'burgundy',
  camel: 'camel', tan: 'camel', beige: 'beige', sand: 'beige', nude: 'beige', khaki: 'olive', taupe: 'beige',
  coral: 'coral', peach: 'peach', blush: 'blush', rose: 'rose', pink: 'pink', fuchsia: 'fuchsia', magenta: 'fuchsia', hotpink: 'fuchsia',
  emerald: 'emerald', forest: 'forest', green: 'green', olive: 'olive', mint: 'mint', teal: 'teal', sage: 'sage',
  mustard: 'mustard', yellow: 'yellow', gold: 'gold', rust: 'rust', terracotta: 'rust', orange: 'orange', brown: 'brown', chocolate: 'brown',
  cobalt: 'cobalt', blue: 'blue', 'sky blue': 'blue', 'baby blue': 'blue', turquoise: 'turquoise', lavender: 'lavender', lilac: 'lavender', purple: 'purple', plum: 'plum', violet: 'purple',
  ivory: 'ivory', cream: 'ivory', 'off-white': 'ivory', white: 'white',
  charcoal: 'charcoal', black: 'black', grey: 'grey', gray: 'grey', silver: 'silver',
  red: 'red', 'true red': 'red',
};
export const CANONICAL_COLOR: Record<string, { temperature: ColorTemp; families: SeasonFamily[] }> = {
  navy: { temperature: 'cool', families: ['Winter', 'Summer'] },
  burgundy: { temperature: 'cool', families: ['Winter', 'Autumn'] },
  camel: { temperature: 'warm', families: ['Autumn'] },
  beige: { temperature: 'warm', families: ['Autumn', 'Spring'] },
  coral: { temperature: 'warm', families: ['Spring'] },
  peach: { temperature: 'warm', families: ['Spring'] },
  blush: { temperature: 'cool', families: ['Summer', 'Spring'] },
  rose: { temperature: 'cool', families: ['Summer'] },
  pink: { temperature: 'cool', families: ['Summer', 'Spring'] },
  fuchsia: { temperature: 'cool', families: ['Winter'] },
  emerald: { temperature: 'cool', families: ['Winter'] },
  forest: { temperature: 'warm', families: ['Autumn'] },
  green: { temperature: 'neutral', families: ['Autumn', 'Spring'] },
  olive: { temperature: 'warm', families: ['Autumn'] },
  mint: { temperature: 'cool', families: ['Summer', 'Spring'] },
  teal: { temperature: 'cool', families: ['Winter', 'Autumn'] },
  sage: { temperature: 'neutral', families: ['Summer', 'Autumn'] },
  mustard: { temperature: 'warm', families: ['Autumn'] },
  yellow: { temperature: 'warm', families: ['Spring', 'Autumn'] },
  gold: { temperature: 'warm', families: ['Autumn'] },
  rust: { temperature: 'warm', families: ['Autumn'] },
  orange: { temperature: 'warm', families: ['Spring', 'Autumn'] },
  brown: { temperature: 'warm', families: ['Autumn'] },
  cobalt: { temperature: 'cool', families: ['Winter'] },
  blue: { temperature: 'cool', families: ['Winter', 'Summer'] },
  turquoise: { temperature: 'cool', families: ['Winter', 'Spring'] },
  lavender: { temperature: 'cool', families: ['Summer'] },
  purple: { temperature: 'cool', families: ['Winter', 'Summer'] },
  plum: { temperature: 'cool', families: ['Winter', 'Autumn'] },
  ivory: { temperature: 'warm', families: ['Spring', 'Autumn'] },
  white: { temperature: 'cool', families: ['Winter', 'Summer'] },
  charcoal: { temperature: 'cool', families: ['Winter'] },
  black: { temperature: 'cool', families: ['Winter'] },
  grey: { temperature: 'cool', families: ['Summer', 'Winter'] },
  silver: { temperature: 'cool', families: ['Winter', 'Summer'] },
  red: { temperature: 'neutral', families: ['Winter', 'Spring'] },
};
