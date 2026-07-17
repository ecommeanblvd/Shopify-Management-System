import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { loadShipReport } from '@/features/ship-report/queries';
import { pnlByMonth, pnlBreakdown } from '@/features/ship-report/pnl';
import { surchargeSummary, surchargeTopRoutes, SURCHARGE_LABELS } from '@/features/ship-report/surcharges';

export const dynamic = 'force-dynamic';

const vnd = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('vi-VN'));
const SEG_LABEL: Record<string, string> = { total: 'Tổng', shopify: 'Shopify', ship_ho: 'Ship hộ' };

type SP = { tab?: string; months?: string; month?: string; sur?: string };

export default async function ShipReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const sp = await searchParams;
  const tab = sp.tab === 'surcharge' ? 'surcharge' : 'pnl';
  const monthsBack = [3, 6, 12].includes(Number(sp.months)) ? Number(sp.months) : 6;

  const raw = await loadShipReport(monthsBack);
  const months = pnlByMonth(raw.pnlItems);
  const monthKeys = [...new Set(months.map((r) => r.month))];
  const pickedMonth = sp.month && monthKeys.includes(sp.month) ? sp.month : monthKeys[0] ?? null;
  const breakdown = pickedMonth ? pnlBreakdown(raw.pnlItems, pickedMonth).slice(0, 20) : [];

  const surRows = surchargeSummary(raw.surchargeItems, raw.totalShipments);
  const pickedSur = sp.sur && surRows.some((r) => r.type === sp.sur) ? sp.sur : surRows[0]?.type ?? null;
  const topRoutes = pickedSur ? surchargeTopRoutes(raw.surchargeItems, pickedSur) : [];

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ tab, months: String(monthsBack), ...(sp.month ? { month: sp.month } : {}), ...(sp.sur ? { sur: sp.sur } : {}), ...patch });
    return `/f/ship-report?${p.toString()}`;
  };

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Báo cáo ship</h1>
          <p className="text-sm text-muted-foreground">
            P&L mảng vận chuyển (Shopify + ship hộ) và phân tích phụ phí từ bill carrier. Chi phí ưu tiên số bill thực; đơn chưa bill dùng dự tính.
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          {[3, 6, 12].map((m) => (
            <Link key={m} href={qs({ months: String(m) })}
              className={`rounded px-2.5 py-1 ${monthsBack === m ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
              {m} tháng
            </Link>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border text-sm">
        {([['pnl', 'P&L theo tháng'], ['surcharge', 'Phụ phí']] as const).map(([key, label]) => (
          <Link key={key} href={qs({ tab: key })}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </Link>
        ))}
      </div>

      {tab === 'pnl' ? (
        <>
          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">P&L theo tháng ({monthsBack} tháng)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Tháng</th><th className="text-left">Segment</th>
                    <th className="text-right">Đơn</th><th className="text-right">Thu</th><th className="text-right">Chi</th>
                    <th className="text-right">Margin</th><th className="text-right">Margin %</th>
                    <th className="text-right" title="% đơn có chi phí từ bill thực">Phủ bill</th>
                  </tr>
                </thead>
                <tbody>
                  {months.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : months.map((r) => (
                    <tr key={`${r.month}-${r.segment}`}
                      className={`border-t border-border/60 [&>td]:px-3 [&>td]:py-2 ${r.segment === 'total' ? 'bg-muted/30 font-medium' : 'text-muted-foreground'}`}>
                      <td className="text-left">
                        {r.segment === 'total'
                          ? <Link href={qs({ month: r.month })} className={`underline-offset-2 hover:underline ${pickedMonth === r.month ? 'text-primary' : ''}`}>{r.month}</Link>
                          : ''}
                      </td>
                      <td className="text-left">{SEG_LABEL[r.segment]}</td>
                      <td className="text-right">{r.orders}</td>
                      <td className="text-right">{vnd(r.revenueVnd)}</td>
                      <td className="text-right">{vnd(r.costVnd)}</td>
                      <td className={`text-right font-medium ${r.marginVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {r.marginVnd >= 0 ? '+' : ''}{vnd(r.marginVnd)}
                      </td>
                      <td className="text-right">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                      <td className="text-right">{r.billedPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Thu Shopify = phí ship khách trả sau giảm (quy VND theo FX store); thu ship hộ = giá thu thực. Click tháng để xem breakdown bên dưới.
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Breakdown {pickedMonth ?? ''} — carrier × quốc gia (top 20)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Carrier</th><th className="text-left">Quốc gia</th>
                    <th className="text-right">Đơn</th><th className="text-right">Thu</th><th className="text-right">Chi</th>
                    <th className="text-right">Margin</th><th className="text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : breakdown.map((r) => (
                    <tr key={`${r.carrierKey}-${r.country}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left uppercase">{r.carrierKey}</td>
                      <td className="text-left">{r.country}</td>
                      <td className="text-right">{r.orders}</td>
                      <td className="text-right">{vnd(r.revenueVnd)}</td>
                      <td className="text-right">{vnd(r.costVnd)}</td>
                      <td className={`text-right font-medium ${r.marginVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {r.marginVnd >= 0 ? '+' : ''}{vnd(r.marginVnd)}
                      </td>
                      <td className="text-right">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      ) : (
        <>
          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Phụ phí theo loại ({monthsBack} tháng · {raw.totalShipments.toLocaleString('vi-VN')} đơn)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Loại phụ phí</th>
                    <th className="text-right">Tổng</th><th className="text-right">Đơn dính</th>
                    <th className="text-right">% đơn</th><th className="text-right">TB/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {surRows.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu phụ phí từ bill.</td></tr>
                  ) : surRows.map((r) => (
                    <tr key={r.type} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left">
                        <Link href={qs({ sur: r.type })} className={`underline-offset-2 hover:underline ${pickedSur === r.type ? 'font-medium text-primary' : ''}`}>{r.label}</Link>
                      </td>
                      <td className="text-right font-medium">{vnd(r.totalVnd)}</td>
                      <td className="text-right">{r.shipments}</td>
                      <td className="text-right">{r.pctOfShipments == null ? '—' : `${r.pctOfShipments}%`}</td>
                      <td className="text-right">{vnd(r.avgVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Nguồn: bill carrier (shipment_charges + bill lines ship hộ). Click loại phụ phí để xem top tuyến bên dưới — căn cứ chỉnh quote và đàm phán giá.
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Top tuyến — {pickedSur ? (SURCHARGE_LABELS[pickedSur] ?? pickedSur) : '—'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Quốc gia</th><th className="text-left">Carrier</th>
                    <th className="text-right">Tổng</th><th className="text-right">Đơn dính</th><th className="text-right">TB/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {topRoutes.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : topRoutes.map((r) => (
                    <tr key={`${r.country}-${r.carrierKey}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left">{r.country}</td>
                      <td className="text-left uppercase">{r.carrierKey}</td>
                      <td className="text-right font-medium">{vnd(r.totalVnd)}</td>
                      <td className="text-right">{r.shipments}</td>
                      <td className="text-right">{vnd(r.avgVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
