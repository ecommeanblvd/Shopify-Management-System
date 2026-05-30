import type { MetricsBucket, Grouping } from '@/features/shopify-orders/dashboard-actions';
import { Card, CardContent } from '@/components/ui/card';

interface MetricsTableProps {
  buckets: MetricsBucket[];
  grouping: Grouping;
  currency: string;
}

export function MetricsTable({ buckets, grouping, currency }: MetricsTableProps) {
  if (buckets.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No data in this window.
        </CardContent>
      </Card>
    );
  }

  const isVendor = grouping === 'vendor';

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-2">{isVendor ? 'Vendor' : 'Period'}</th>
              <th className="text-right px-4 py-2">Orders</th>
              <th className="text-right px-4 py-2">GMV</th>
              {!isVendor && <th className="text-right px-4 py-2">Refunded</th>}
              <th className="text-right px-4 py-2">Discount</th>
              {!isVendor && <th className="text-right px-4 py-2">Ship rev</th>}
              <th className="text-right px-4 py-2">Ship cost</th>
              <th className="text-right px-4 py-2">SKU cost</th>
              <th className="text-right px-4 py-2">Revenue</th>
              <th className="text-right px-4 py-2">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.bucketKey} className="border-b border-border/40">
                <td className="px-4 py-2 font-mono">{b.bucketLabel}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {b.metrics.orderCount.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {fmt(b.metrics.gmv, currency)}
                </td>
                {!isVendor && (
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-destructive">
                    {fmt(b.metrics.refundedAmount, currency)}
                  </td>
                )}
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {fmt(b.metrics.discount, currency)}
                </td>
                {!isVendor && (
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {fmt(b.metrics.shippingRevenue, currency)}
                  </td>
                )}
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {fmt(b.metrics.shippingCost, currency)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {fmt(b.metrics.skuCost, currency)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">
                  {fmt(b.metrics.revenue, currency)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {(b.metrics.margin * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
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
