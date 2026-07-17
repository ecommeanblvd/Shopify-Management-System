/**
 * GET /api/external/transit-stats?days=30
 * Tiến độ ship trung bình theo quốc gia × line vận chuyển (window = đơn tạo vận
 * đơn trong N ngày). Auth: Bearer EXTERNAL_API_KEY.
 */
import { requireExternalApiKey } from '@/lib/external-api';
import { getTransitStats, normalizeTransitRange, pivotRoutesByCountry } from '@/features/shipments/transit-stats';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const denied = requireExternalApiKey(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const days = normalizeTransitRange(url.searchParams.get('days') ?? undefined);
  const stats = await getTransitStats(days);

  return Response.json({
    generatedAt: new Date().toISOString(),
    windowDays: days,
    // routes: từng tuyến carrier × quốc gia (shipped/delivered/avg/min/max ngày).
    routes: stats.routes,
    // carriers: tổng hợp theo carrier (avg + median).
    carriers: stats.carriers,
    // matrix: nước × carrier (avg ngày) — so tốc độ giữa các line trên cùng tuyến.
    matrix: pivotRoutesByCountry(stats.routes),
    latestDeliveryAt: stats.latestDeliveryAt,
  });
}
