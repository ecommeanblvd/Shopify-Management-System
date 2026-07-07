/**
 * THUẦN: luật mỗi dáng → thuộc tính garment (khớp vocab dictionaries.ts).
 * research-body.md §6. SOFT weight (recommender không hard-filter). ids khớp
 * NECKLINE/SILHOUETTE/FIT/FEATURE_KEYWORDS.
 */
import type { BodyShape } from './body-shape';

export interface BodyRule {
  goodNecklines: string[];
  avoidNecklines: string[];
  goodSilhouettes: string[];
  avoidSilhouettes: string[];
  goodFits: string[];
  goodFeatures: string[];
  avoidFeatures: string[];
}

export const BODY_RULES: Record<BodyShape, BodyRule> = {
  hourglass: {
    goodNecklines: ['v_neck', 'scoop', 'sweetheart', 'cowl'],
    avoidNecklines: ['jewel'], // crew/turtleneck adds bulk at bust
    goodSilhouettes: ['wrap', 'fit_and_flare', 'bodycon', 'column', 'mermaid', 'pencil'],
    avoidSilhouettes: ['shift'],
    goodFits: ['fitted'],
    goodFeatures: ['waist_defining', 'high_waist'],
    avoidFeatures: [], // đừng phạt cứng — chỉ boost mặt tốt
  },
  pear: {
    goodNecklines: ['boat', 'square', 'sweetheart', 'scoop', 'off_shoulder', 'cowl'],
    avoidNecklines: [],
    goodSilhouettes: ['fit_and_flare', 'wrap', 'a_line', 'empire'],
    avoidSilhouettes: ['bodycon'],
    goodFits: ['structured'],
    goodFeatures: ['puff_sleeve', 'off_shoulder', 'waist_defining'],
    avoidFeatures: [],
  },
  apple: {
    goodNecklines: ['v_neck', 'scoop', 'cowl', 'sweetheart'],
    avoidNecklines: ['jewel'], // high/narrow che décolletage
    goodSilhouettes: ['empire', 'a_line', 'wrap', 'column', 'shift'],
    avoidSilhouettes: ['bodycon'],
    goodFits: ['relaxed', 'structured'],
    goodFeatures: ['vertical'],
    avoidFeatures: ['crop'], // + belt-at-natural-waist (không có id riêng) — chỉ nhẹ
  },
  rectangle: {
    goodNecklines: ['scoop', 'sweetheart', 'cowl', 'v_neck'],
    avoidNecklines: [],
    goodSilhouettes: ['peplum', 'fit_and_flare', 'wrap', 'empire'],
    avoidSilhouettes: [],
    goodFits: ['fitted'],
    goodFeatures: ['waist_defining', 'peplum', 'ruffle', 'puff_sleeve'],
    avoidFeatures: [],
  },
  invertedTriangle: {
    goodNecklines: ['v_neck', 'scoop'],
    avoidNecklines: ['boat', 'halter', 'off_shoulder'], // làm rộng vai
    goodSilhouettes: ['a_line', 'fit_and_flare', 'pleated'],
    avoidSilhouettes: [],
    goodFits: ['relaxed'],
    goodFeatures: ['full_skirt', 'vertical', 'waist_defining'],
    avoidFeatures: ['puff_sleeve', 'off_shoulder'], // thêm khối vai
  },
};
