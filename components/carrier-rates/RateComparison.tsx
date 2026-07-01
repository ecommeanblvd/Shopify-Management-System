'use client';

import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { ComparisonCube, CompareCountryMeta } from '@/features/carrier-rates/compare/build-comparison';

interface Props {
  cube: ComparisonCube;
  countryMeta: CompareCountryMeta[];
}

/** Dot màu ổn định theo carrier (ánh xạ accountId → 1 màu trong palette). */
const DOT_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777'];

/** VND gọn: ≥1tr → "1,25tr"; ≥1k → "690k"; nhỏ hơn → số nguyên. */
function fmtVnd(v: number): string {
  if (v >= 1_000_000) {
    const tr = v / 1_000_000;
    return `${tr.toFixed(tr >= 10 ? 1 : 2).replace('.', ',')}tr`;
  }
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

function fmtWeight(kg: number): string {
  return Number.isInteger(kg) ? `${kg}` : kg.toString().replace('.', ',');
}

export function RateComparison({ cube, countryMeta }: Props) {
  const [query, setQuery] = useState('');

  // Màu ổn định cho từng accountId xuất hiện trong bảng.
  const colorByAccount = useMemo(() => {
    const ids = new Set<string>();
    for (const byW of Object.values(cube.cells))
      for (const cell of Object.values(byW))
        for (const r of cell.rates) ids.add(r.accountId);
    const map = new Map<string, string>();
    [...ids].forEach((id, i) => map.set(id, DOT_PALETTE[i % DOT_PALETTE.length]));
    return map;
  }, [cube]);

  const shownCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countryMeta;
    return countryMeta.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [query, countryMeta]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Lọc nhanh quốc gia…"
          className="pl-9"
        />
      </div>

      <div className="overflow-auto rounded-xl border border-border max-h-[75vh]">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted">
              <th className="sticky left-0 z-30 bg-muted border-b border-r border-border px-3 py-2 text-left font-medium whitespace-nowrap">
                Cân (kg)
              </th>
              {shownCountries.map((c) => (
                <th key={c.code} className="border-b border-r border-border px-3 py-2 text-left font-medium whitespace-nowrap min-w-[9rem]">
                  <div>{c.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{c.code} · {c.orders} đơn</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cube.weights.map((w) => (
              <tr key={w} className="even:bg-muted/30">
                <td className="sticky left-0 z-10 bg-background even:bg-muted/30 border-b border-r border-border px-3 py-2 font-medium tabular-nums whitespace-nowrap">
                  {fmtWeight(w)}
                </td>
                {shownCountries.map((c) => {
                  const rates = cube.cells[c.code]?.[w]?.rates ?? [];
                  return (
                    <td key={c.code} className="border-b border-r border-border px-2 py-1.5 align-top">
                      {rates.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {rates.map((r) => (
                            <div
                              key={r.accountId}
                              className={cn(
                                'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs',
                                r.cheapest && 'bg-green-100 dark:bg-green-950/50 font-semibold',
                              )}
                            >
                              {r.cheapest ? (
                                <Check className="size-3 text-green-600 shrink-0" />
                              ) : (
                                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: colorByAccount.get(r.accountId) }} />
                              )}
                              <span className="truncate max-w-[6rem]" title={r.carrierName}>{r.carrierName}</span>
                              <span className="ml-auto tabular-nums">{fmtVnd(r.vnd)}</span>
                              {!r.cheapest && (
                                <span className="tabular-nums text-muted-foreground w-9 text-right">+{r.pctOverCheapest}%</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Cước all-in VND (base + phụ phí xăng dầu tuần hiện tại + VAT), gói Pak. Ô trống (—) = carrier
        không phủ nước đó. Không gồm phụ phí theo địa chỉ (remote/residential).
      </p>
    </div>
  );
}
