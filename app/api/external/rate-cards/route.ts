/**
 * GET /api/external/rate-cards
 * Bảng giá carrier CURRENT (đang áp dụng hôm nay) — zones × weight tiers × giá
 * mua vào theo cost currency của account. Auth: Bearer EXTERNAL_API_KEY.
 */
import { requireExternalApiKey } from '@/lib/external-api';
import { getCurrentRateCards } from '@/features/carrier-rates/current-cards';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const denied = requireExternalApiKey(req);
  if (denied) return denied;

  const cards = await getCurrentRateCards();
  return Response.json({ generatedAt: new Date().toISOString(), cards });
}
