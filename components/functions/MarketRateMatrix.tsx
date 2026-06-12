'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';
import { carriersInZones, buildZoneWeightMatrix, bracketMatchesWeight, zoneCarrierLabel } from '@/features/markets/domain/shipping-matrix-view';

function fmtPrice(price: number, currency: string): string {
  if (currency === 'USD') return `$${price.toFixed(2)}`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ${currency}`;
}

/** Một market: tab carrier + ma trận rate-card gốc (cột = zone, dòng = bậc cân).
 *  Header cột là MÃ ZONE ngắn (key = ME1/US1…) + dòng phụ nhỏ (`label` carrier-zone
 *  gốc + mã nước). Header dính trên, cột bậc cân dính trái. `highlightWeight` → tô
 *  sáng + cuộn tới dòng bậc chứa cân đó. */
export function MarketRateMatrix({ zones, highlightWeight }: { zones: ZoneView[]; highlightWeight: number | null }) {
  const carriers = useMemo(() => carriersInZones(zones), [zones]);
  const [carrier, setCarrier] = useState(carriers[0] ?? '');
  const active = carriers.includes(carrier) ? carrier : carriers[0] ?? '';
  const matrix = useMemo(() => buildZoneWeightMatrix(zones, active), [zones, active]);
  const meta = useMemo(() => new Map(zones.map((z) => [z.zoneName, z])), [zones]);

  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (highlightWeight != null && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightWeight, active]);

  if (carriers.length === 0) return <p className="text-sm text-muted-foreground">Chưa có giá ship.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {carriers.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCarrier(c)}
            className={`rounded border px-3 py-1 text-sm ${c === active ? 'border-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Carrier này chưa có bậc giá ở các zone đang hiện.</p>
      ) : (
        <div className="max-h-[70vh] w-fit max-w-full overflow-auto rounded-md border border-border">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-border bg-background px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bậc cân
                </th>
                {matrix.zoneNames.map((zn) => {
                  const z = meta.get(zn);
                  return (
                    <th
                      key={zn}
                      className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-background px-3 py-1.5 text-right align-bottom"
                      title={z?.label ?? zn}
                    >
                      <div className="text-sm font-semibold text-foreground">{zn}</div>
                      <div className="text-[10px] font-normal normal-case text-muted-foreground">{zoneCarrierLabel(z?.label ?? zn)}</div>
                      {z && z.countries.length > 0 && (
                        <div className="text-[10px] font-mono font-normal text-muted-foreground/80">{z.countries.join(' ')}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {matrix.rows.map((row) => {
                const hit = highlightWeight != null && bracketMatchesWeight(row.bracket, highlightWeight);
                return (
                  <tr key={row.bracket} ref={hit ? rowRef : undefined} className={hit ? 'bg-amber-500/15' : undefined}>
                    <th className={`sticky left-0 z-10 whitespace-nowrap border-b border-r border-border px-3 py-1 text-left font-sans font-normal ${hit ? 'bg-amber-500/15' : 'bg-background'}`}>
                      {row.bracket}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={matrix.zoneNames[i]} className="border-b border-border px-3 py-1 text-right">
                        {cell ? fmtPrice(cell.price, cell.currency) : '—'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
