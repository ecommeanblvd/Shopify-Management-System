import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';
import { buildRateMatrix } from '@/features/markets/domain/shipping-matrix-view';

function fmtPrice(price: number, currency: string): string {
  if (currency === 'USD') return `$${price.toFixed(2)}`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ${currency}`;
}

export function ShippingMatrixTable({ zones }: { zones: ZoneView[] }) {
  if (zones.length === 0) return <p className="text-sm text-muted-foreground">Chưa có giá ship cho market này.</p>;
  return (
    <div className="space-y-4">
      {zones.map((z) => {
        const m = buildRateMatrix(z);
        return (
          <div key={z.zoneName} className="overflow-hidden rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <div className="text-sm font-medium">{z.zoneName}</div>
              {z.countries.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {z.countries.map((c) => (<span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">{c}</span>))}
                </div>
              )}
            </div>
            {m.rows.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Chưa có bậc giá.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-1.5 text-left font-medium">Bậc cân</th>
                    {m.carriers.map((c) => (<th key={c} className="px-3 py-1.5 text-right font-medium">{c}</th>))}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {m.rows.map((row) => (
                    <tr key={row.bracket} className="border-t border-border first:border-t-0">
                      <td className="px-3 py-1 font-sans">{row.bracket}</td>
                      {row.cells.map((cell, i) => (
                        <td key={m.carriers[i]} className="px-3 py-1 text-right">{cell ? fmtPrice(cell.price, cell.currency) : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
