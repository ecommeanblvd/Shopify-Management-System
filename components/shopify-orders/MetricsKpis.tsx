import type { AggregateMetrics } from '@/features/shopify-orders/metrics/aggregate';
import { Card, CardContent } from '@/components/ui/card';

interface MetricsKpisProps {
  metrics: AggregateMetrics;
}

export function MetricsKpis({ metrics }: MetricsKpisProps) {
  const duCogs = `${metrics.soDonDuCogs}/${metrics.orderCount} đơn đủ COGS`;
  const chuaTinh = metrics.soDonThieuCogs > 0
    ? `chưa tính: ${fmt(metrics.netSalesThieuCogs, metrics.currency)} net sales của ${metrics.soDonThieuCogs} đơn thiếu COGS`
    : null;
  const tiles: Array<{ label: string; value: string; sub: string; sub2?: string | null; tone?: 'pos' | 'neg' }> = [
    { label: 'Gross sales (GMV)', value: fmt(metrics.gmv, metrics.currency), sub: 'trước chiết khấu, gồm ship' },
    {
      label: 'Refunded',
      value: fmt(metrics.refundedAmount, metrics.currency),
      sub: 'window refunds',
      tone: 'neg',
    },
    { label: 'Net sales', value: fmt(metrics.netSales, metrics.currency), sub: 'khách thực trả = GMV − discount − refund' },
    {
      label: 'Revenue',
      value: metrics.soDonDuCogs > 0 ? fmt(metrics.revenueDuCogs, metrics.currency) : '—',
      sub: `net after costs · ${duCogs}`,
      sub2: chuaTinh,
      tone: 'pos',
    },
    {
      label: 'Margin %',
      value: metrics.soDonDuCogs > 0 ? `${(metrics.margin * 100).toFixed(1)}%` : '—',
      sub: `revenue / net sales · trên ${duCogs}`,
      sub2: chuaTinh ? `đơn thiếu COGS không tính vào đây` : null,
    },
    {
      label: 'Orders',
      value: metrics.orderCount.toLocaleString(),
      sub: `${(metrics.skuCostCoverage * 100).toFixed(0)}% cost coverage`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border rounded-2xl overflow-hidden border border-border">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card p-5 space-y-1.5">
          <div className="text-muted-foreground text-xs uppercase tracking-wider">{t.label}</div>
          <div
            className={`text-2xl font-semibold tabular-nums ${
              t.tone === 'neg'
                ? 'text-destructive'
                : t.tone === 'pos'
                  ? 'text-emerald-500'
                  : ''
            }`}
          >
            {t.value}
          </div>
          <div className="text-xs text-muted-foreground truncate" title={t.sub}>{t.sub}</div>
          {t.sub2 && <div className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug" title={t.sub2}>{t.sub2}</div>}
        </div>
      ))}
    </div>
  );
}

function fmt(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toFixed(0);
  }
}
