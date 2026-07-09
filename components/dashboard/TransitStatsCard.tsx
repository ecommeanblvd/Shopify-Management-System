import Link from 'next/link';
import { Timer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  TRANSIT_RANGE_DAYS, pivotRoutesByCountry,
  type TransitRangeDays, type TransitStats,
} from '@/features/shipments/transit-stats';

/** ISO-2 → emoji cờ (regional indicators). */
function flag(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
};

/**
 * Dashboard: thời gian ship trung bình tới từng nước theo line ship. Window =
 * HÀNG ĐI (tạo vận đơn) trong 7/14/30/90 ngày (?transit=N); filter carrier
 * (?tcarrier=key); kèm bảng nhỏ so sánh tốc độ giao giữa các carrier theo nước.
 */
export function TransitStatsCard({ stats, days, carrier }: {
  stats: TransitStats;
  days: TransitRangeDays;
  carrier: string | null;
}) {
  const totalShipped = stats.carriers.reduce((t, c) => t + c.shippedN, 0);
  const totalDelivered = stats.carriers.reduce((t, c) => t + c.deliveredN, 0);
  const carrierKeys = stats.carriers.map((c) => c.carrierKey).filter((k) => k !== '?').sort();
  const activeCarrier = carrier && carrierKeys.includes(carrier) ? carrier : null;
  const routes = activeCarrier ? stats.routes.filter((r) => r.carrierKey === activeCarrier) : stats.routes;
  const pivot = pivotRoutesByCountry(stats.routes);
  const href = (d: TransitRangeDays, c: string | null) => `/?transit=${d}${c ? `&tcarrier=${c}` : ''}#transit`;

  return (
    <section id="transit" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Timer className="size-4" />
          Thời gian ship theo tuyến — hàng đi {days} ngày qua
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          {/* Filter carrier */}
          <Link href={href(days, null)} scroll={false}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${!activeCarrier ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            Mọi carrier
          </Link>
          {carrierKeys.map((k) => (
            <Link key={k} href={href(days, k)} scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium uppercase transition ${k === activeCarrier ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {k}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {/* Filter mốc thời gian */}
          {TRANSIT_RANGE_DAYS.map((d) => (
            <Link key={d} href={href(d, activeCarrier)} scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${d === days ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {d} ngày
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr] items-start">
        {/* Bảng chính: tuyến (theo carrier đã lọc) */}
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border px-4 py-3 text-sm">
              {stats.carriers.length === 0 && (
                <span className="text-muted-foreground">Không có kiện nào tạo vận đơn trong {days} ngày qua.</span>
              )}
              {stats.carriers
                .filter((c) => !activeCarrier || c.carrierKey === activeCarrier)
                .map((c) => (
                  <div key={c.carrierKey} className="flex items-baseline gap-2">
                    <span className="font-semibold uppercase">{c.carrierKey}</span>
                    <span className="tabular-nums">đi <b>{c.shippedN}</b> kiện</span>
                    <span className="text-xs text-muted-foreground tabular-nums">· ghi nhận giao {c.deliveredN}</span>
                    {c.avgDays != null
                      ? <span className="tabular-nums">· TB <b>{c.avgDays}</b> ngày{c.medianDays != null ? <span className="text-xs text-muted-foreground"> (median {c.medianDays})</span> : null}</span>
                      : <span className="text-xs text-muted-foreground">· chưa có dữ liệu giao</span>}
                  </div>
                ))}
            </div>

            {routes.length > 0 && (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="sticky top-0 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                      <th className="text-left">Tuyến</th>
                      <th className="text-right">Kiện đi</th>
                      <th className="text-right">Đã giao</th>
                      <th className="text-right">Trung bình</th>
                      <th className="text-right">Nhanh nhất</th>
                      <th className="text-right">Chậm nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((r) => (
                      <tr key={`${r.carrierKey}-${r.country}`} className="border-t border-border/60 [&>td]:px-4 [&>td]:py-2">
                        <td className="text-left">
                          <span className="mr-1.5">{flag(r.country)}</span>
                          <span className="font-medium">{r.country}</span>
                          <span className="ml-2 text-xs uppercase text-muted-foreground">{r.carrierKey}</span>
                          {r.deliveredN > 0 && r.deliveredN < 3 && <span className="ml-2 text-[10px] text-muted-foreground" title="Mẫu giao nhỏ — số chỉ tham khảo">mẫu nhỏ</span>}
                        </td>
                        <td className="text-right">{r.shippedN}</td>
                        <td className="text-right">{r.deliveredN > 0 ? r.deliveredN : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right font-semibold">{r.avgDays != null ? `${r.avgDays} ngày` : <span className="font-normal text-muted-foreground">chưa có</span>}</td>
                        <td className="text-right text-muted-foreground">{r.minDays ?? '—'}</td>
                        <td className={`text-right ${r.maxDays != null && r.maxDays >= 15 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{r.maxDays ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Window = kiện TẠO VẬN ĐƠN trong {days} ngày qua ({totalShipped} kiện, {totalDelivered} đã ghi nhận giao).
              Transit = tạo vận đơn → giao thành công. Dữ liệu giao mới nhất: <b>{fmtDate(stats.latestDeliveryAt)}</b>.
            </p>
          </CardContent>
        </Card>

        {/* Bảng nhỏ: so sánh tốc độ giao giữa các carrier theo nước */}
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              So tốc độ giao giữa carrier <span className="ml-1 text-[11px] font-normal text-muted-foreground">TB ngày · (số kiện)</span>
            </div>
            {pivot.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Chưa có tuyến nào ghi nhận giao trong window.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="sticky top-0 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                      <th className="text-left">Nước</th>
                      {pivot.carriers.map((k) => <th key={k} className="text-right">{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pivot.rows.map((row) => {
                      // Carrier nhanh nhất tuyến này (có ≥1 kiện) → tô xanh.
                      const best = Math.min(...Object.values(row.byCarrier).map((x) => x.avgDays));
                      return (
                        <tr key={row.country} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                          <td className="text-left"><span className="mr-1">{flag(row.country)}</span><span className="font-medium">{row.country}</span></td>
                          {pivot.carriers.map((k) => {
                            const cell = row.byCarrier[k];
                            if (!cell) return <td key={k} className="text-right text-muted-foreground">—</td>;
                            const isBest = cell.avgDays === best && Object.keys(row.byCarrier).length > 1;
                            return (
                              <td key={k} className={`text-right ${isBest ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}`}>
                                {cell.avgDays} <span className="text-[10px] text-muted-foreground">({cell.deliveredN})</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Xanh = carrier giao nhanh nhất tuyến (khi tuyến có ≥2 carrier). Luôn tính trên mọi carrier, không theo filter.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
