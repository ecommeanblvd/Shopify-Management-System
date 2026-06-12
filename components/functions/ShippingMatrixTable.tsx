import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';

function fmtPrice(price: number, currency: string): string {
  if (currency === 'USD') return `$${price.toFixed(2)}`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ${currency}`;
}

export function ShippingMatrixTable({ zones }: { zones: ZoneView[] }) {
  if (zones.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có giá ship cho market này.</p>;
  }
  return (
    <div className="space-y-4">
      {zones.map((z) => (
        <div key={z.zoneName} className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium">{z.zoneName}</div>
            {z.countries.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {z.countries.map((c) => (
                  <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">{c}</span>
                ))}
              </div>
            )}
          </div>
          {z.rates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Chưa có bậc giá.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="font-mono tabular-nums">
                {z.rates.map((r) => (
                  <tr key={r.label} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-1 font-sans">{r.label}</td>
                    <td className="px-3 py-1 text-right">{fmtPrice(r.price, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
