'use server';

import { assembleAnswers, type OptionalBodyExtras } from '@/features/customer-account/style-quiz/quiz-definition';
import { deriveProfile } from '@/features/customer-account/style-quiz/profile';
import { recommendForProfile } from '@/features/customer-account/style-quiz/recommend-quiz';
import { getStoreCatalogForQuiz } from '@/features/customer-account/style-quiz/queries';

export interface QuizPreviewResult {
  profile: {
    season: string; palette: string[]; avoid: string[]; temperature: string; sisterFallback: string | null;
    shape: string; heightBand: string;
    archetype: string; archetypeSecondary: string | null; keywords: string[];
  };
  catalogSize: number;
  recommendations: Array<{
    title: string; handle: string; imageUrl: string | null; price: string | null; currency: string | null;
    category: string | null; reasons: string[]; score: number;
  }>;
}

/** Chạy quiz phía server: raw answers → profile → gợi ý từ catalog của store. */
export async function runQuizPreview(
  storeId: string,
  raw: Record<string, string>,
  extras: OptionalBodyExtras = {},
): Promise<QuizPreviewResult> {
  const answers = assembleAnswers(raw, extras);
  const profile = deriveProfile(answers, { refined: true, levelReached: 2 });
  const catalog = await getStoreCatalogForQuiz(storeId);
  const recs = recommendForProfile(profile, catalog, { topN: 12 });

  return {
    profile: {
      season: profile.color.season, palette: profile.color.palette, avoid: profile.color.avoid,
      temperature: profile.color.temperature, sisterFallback: profile.color.sisterFallback,
      shape: profile.body.shape, heightBand: profile.body.heightBand,
      archetype: profile.archetype.primary, archetypeSecondary: profile.archetype.secondary,
      keywords: profile.archetype.keywords,
    },
    catalogSize: catalog.length,
    recommendations: recs.map((r) => ({
      title: r.title, handle: r.handle, imageUrl: r.imageUrl, price: r.priceMin, currency: r.currency,
      category: r.attrs.category, reasons: r.reasons, score: Math.round(r.score * 100) / 100,
    })),
  };
}
