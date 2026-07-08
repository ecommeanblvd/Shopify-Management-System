import Link from 'next/link';
import { Timer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TRANSIT_RANGE_DAYS, type TransitRangeDays, type TransitStats } from '@/features/shipments/transit-stats';

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
 * Dashboard: thời gian ship trung bình tới từng nước theo line ship, filter theo
 * mốc thời gian (giao trong 7/14/30/90 ngày gần nhất) qua URL param `transit`.
 */
export function TransitStatsCard({ stats, days }: { stats: TransitStats; days: TransitRangeDays }) {
  const hasData = stats.routes.length > 0;
  return (
    <section id="transit" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Timer className="size-4" />
          Thời gian ship trung bình theo tuyến
        </h2>
        <div className="flex items-center gap-1">
          {TRANSIT_RANGE_DAYS.map((d) => (
            <Link key={d} href={`/?transit=${d}#transit`} scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${d === days
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {d} ngày
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Tóm tắt theo carrier */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border px-4 py-3 text-sm">
            {stats.carriers.length === 0 && (
              <span className="text-muted-foreground">Chưa có kiện nào ghi nhận giao trong {days} ngày qua.</span>
            )}
            {stats.carriers.map((c) => (
              <div key={c.carrierKey} className="flex items-baseline gap-2">
                <span className="font-semibold uppercase">{c.carrierKey}</span>
                <span className="tabular-nums">TB <b>{c.avgDays}</b> ngày</span>
                <span className="text-xs text-muted-foreground tabular-nums">median {c.medianDays} · {c.n} kiện giao</span>
                {c.pendingN > 0 && <span className="text-xs text-muted-foreground tabular-nums">· {c.pendingN} đang đi</span>}
              </div>
            ))}
          </div>

          {/* Bảng tuyến */}
          {hasData && (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Tuyến</th>
                    <th className="text-right">Kiện giao</th>
                    <th className="text-right">Trung bình</th>
                    <th className="text-right">Nhanh nhất</th>
                    <th className="text-right">Chậm nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.routes.map((r) => (
                    <tr key={`${r.carrierKey}-${r.country}`} className="border-t border-border/60 [&>td]:px-4 [&>td]:py-2">
                      <td className="text-left">
                        <span className="mr-1.5">{flag(r.country)}</span>
                        <span className="font-medium">{r.country}</span>
                        <span className="ml-2 text-xs uppercase text-muted-foreground">{r.carrierKey}</span>
                        {r.n < 3 && <span className="ml-2 text-[10px] text-muted-foreground" title="Mẫu nhỏ — số chỉ tham khảo">mẫu nhỏ</span>}
                      </td>
                      <td className="text-right">{r.n}</td>
                      <td className="text-right font-semibold">{r.avgDays} ngày</td>
                      <td className="text-right text-muted-foreground">{r.minDays}</td>
                      <td className={`text-right ${r.maxDays >= 15 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{r.maxDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Transit = từ lúc tạo vận đơn → giao thành công (gồm thời gian chờ carrier lấy hàng). Lọc theo ngày GIAO trong {days} ngày qua.
            Dữ liệu giao ghi nhận mới nhất: <b>{fmtDate(stats.latestDeliveryAt)}</b> — nguồn Lark ops/carrier, có thể trễ vài ngày.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
