/**
 * GET /api/external/ship-report?months=6
 * Báo cáo ship cho app ngoài: P&L theo tháng (+ breakdown carrier×quốc gia
 * từng tháng) + phân tích phụ phí. Auth: Bearer EXTERNAL_API_KEY.
 */
import { requireExternalApiKey } from '@/lib/external-api';
import { loadShipReport } from '@/features/ship-report/queries';
import { pnlByMonth, pnlBreakdown } from '@/features/ship-report/pnl';
import { surchargeSummary, surchargeTopRoutes } from '@/features/ship-report/surcharges';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const denied = requireExternalApiKey(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const monthsBack = [3, 6, 12].includes(Number(url.searchParams.get('months')))
    ? Number(url.searchParams.get('months')) : 6;

  const raw = await loadShipReport(monthsBack);
  const months = pnlByMonth(raw.pnlItems);
  const monthKeys = [...new Set(months.map((r) => r.month))];
  const surcharges = surchargeSummary(raw.surchargeItems, raw.totalShipments);

  return Response.json({
    generatedAt: new Date().toISOString(),
    monthsBack,
    currency: 'VND',
    pnl: {
      months,
      breakdownByMonth: Object.fromEntries(
        monthKeys.map((m) => [m, pnlBreakdown(raw.pnlItems, m)]),
      ),
    },
    surcharges: {
      summary: surcharges,
      topRoutesByType: Object.fromEntries(
        surcharges.map((s) => [s.type, surchargeTopRoutes(raw.surchargeItems, s.type)]),
      ),
    },
  });
}
