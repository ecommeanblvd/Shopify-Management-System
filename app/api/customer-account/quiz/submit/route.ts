/**
 * POST /api/customer-account/quiz/submit — extension gửi câu trả lời → SMS tính
 * StyleProfile (3 trục) + gợi ý sản phẩm từ catalog store, lưu kết quả.
 * Body: { answers: Record<qid,value>, extras?: {heightCm,proportion}, sessionKey, levelReached, topN }
 */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../../_shared';
import { assembleAnswers } from '@/features/customer-account/style-quiz/quiz-definition';
import { deriveProfile } from '@/features/customer-account/style-quiz/profile';
import { recommendForProfile } from '@/features/customer-account/style-quiz/recommend-quiz';
import { getStoreCatalogForQuiz, saveQuizResult } from '@/features/customer-account/style-quiz/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(): Response { return preflight(); }

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;

  let body: { answers?: Record<string, string>; extras?: { heightCm?: number; proportion?: string }; sessionKey?: string; levelReached?: number; topN?: number };
  try { body = await req.json(); } catch { return caJson({ error: 'invalid json' }, 400); }

  const level = body.levelReached ?? 1;
  const answers = assembleAnswers(body.answers ?? {}, {
    heightCm: body.extras?.heightCm,
    proportion: body.extras?.proportion as never,
  });
  const profile = deriveProfile(answers, { refined: level >= 2, levelReached: level });

  const catalog = await getStoreCatalogForQuiz(auth.store.id);
  const recs = recommendForProfile(profile, catalog, { topN: body.topN ?? 12 });

  await saveQuizResult({
    storeId: auth.store.id, customerId: auth.customerId,
    sessionKey: body.sessionKey ?? 'anon', answers: body.answers ?? {}, profile, levelReached: level,
  }).catch(() => { /* lưu là best-effort, không chặn trả kết quả */ });

  return caJson({
    profile: {
      color: { season: profile.color.season, palette: profile.color.palette, avoid: profile.color.avoid, temperature: profile.color.temperature, sisterFallback: profile.color.sisterFallback },
      body: { shape: profile.body.shape, heightBand: profile.body.heightBand },
      archetype: { primary: profile.archetype.primary, secondary: profile.archetype.secondary, keywords: profile.archetype.keywords },
    },
    recommendations: recs.map((r) => ({
      title: r.title, handle: r.handle, imageUrl: r.imageUrl, price: r.priceMin, currency: r.currency,
      category: r.attrs.category, reasons: r.reasons, score: Math.round(r.score * 100) / 100,
    })),
  });
}
