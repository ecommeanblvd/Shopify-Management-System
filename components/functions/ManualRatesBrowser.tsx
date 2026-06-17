'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';
import { carriersInZones, buildZoneWeightMatrix, bracketMatchesWeight, parseRateSearch, zoneCarrierLabel, summarizeZoneCountries } from '@/features/markets/domain/shipping-matrix-view';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { FeeCoverageResult } from '@/features/carrier-rates/push/fee-coverage';

export interface MarketZones { marketHandle: string; zones: ZoneView[]; }

type Col = ZoneView & { market: string };

function fmtPrice(price: number, currency: string): string {
  if (currency === 'USD') return `$${price.toFixed(2)}`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ${currency}`;
}

// Cho phép search theo TÊN quốc gia (vd "Saudi", "Nhật") chứ không chỉ mã ISO.
const regionEn = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const regionVi = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['vi'], { type: 'region' }) : null;
const countryTextCache = new Map<string, string>();
/** Chuỗi search cho 1 mã nước: gồm mã + tên tiếng Anh + tên tiếng Việt (lowercase). */
function countrySearchText(code: string): string {
  const k = code.toUpperCase();
  let v = countryTextCache.get(k);
  if (v === undefined) {
    const parts = [k];
    try { const en = regionEn?.of(k); if (en) parts.push(en); } catch { /* mã lạ */ }
    try { const vi = regionVi?.of(k); if (vi) parts.push(vi); } catch { /* mã lạ */ }
    v = parts.join(' ').toLowerCase();
    countryTextCache.set(k, v);
  }
  return v;
}

/** MỘT bảng cho cả store: cột = mọi zone (ME1, ME2, US1…) gộp ngang theo market,
 *  dòng = bậc cân (hợp nhất, sắp theo cận trên kg). Tab carrier chung; header zone
 *  dính trên, cột bậc cân dính trái; vạch ngăn giữa các market. Search lọc cột
 *  zone (mã/nhãn/nước/market) hoặc gõ mốc cân để tô sáng + nhảy tới dòng. */
export function ManualRatesBrowser({ markets, coverage }: { markets: MarketZones[]; coverage?: Record<string, FeeCoverageResult> }) {
  const [q, setQ] = useState('');
  const { needle, weight } = parseRateSearch(q);

  const allZones = useMemo<Col[]>(
    () => markets.flatMap((m) => m.zones.map((z) => ({ ...z, market: m.marketHandle }))),
    [markets],
  );
  const carriers = useMemo(() => carriersInZones(allZones), [allZones]);
  const [carrier, setCarrier] = useState(carriers[0] ?? '');
  const active = carriers.includes(carrier) ? carrier : carriers[0] ?? '';

  // Chỉ giữ cột zone có carrier đang chọn, rồi lọc theo needle.
  const cols = useMemo(
    () =>
      allZones
        .filter((z) => carriersInZones([z]).includes(active))
        .filter((z) =>
          needle === '' ||
          z.zoneName.toLowerCase().includes(needle) ||
          z.market.toLowerCase().includes(needle) ||
          (z.label ?? '').toLowerCase().includes(needle) ||
          z.countries.some((c) => countrySearchText(c).includes(needle)),
        ),
    [allZones, active, needle],
  );
  const matrix = useMemo(() => buildZoneWeightMatrix(cols, active), [cols, active]);
  const meta = useMemo(() => new Map(cols.map((z) => [z.zoneName, z])), [cols]);

  // Khớp tab carrier đang chọn ("FedEx IP" / "DHL Express") với coverage theo
  // brand ('fedex'/'dhl') bằng substring — không phụ thuộc nhãn chính xác.
  const activeCoverage = useMemo<FeeCoverageResult | undefined>(() => {
    if (!coverage) return undefined;
    const a = active.toLowerCase();
    const key = Object.keys(coverage).find((k) => a.includes(k.toLowerCase()));
    return key ? coverage[key] : undefined;
  }, [coverage, active]);

  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (weight != null && rowRef.current) rowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [weight, active]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
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
        {activeCoverage?.fuelPercent != null && (
          <span className="ml-auto inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/5 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-400">
            🛢️ Fuel đang áp: {activeCoverage.fuelPercent}%
          </span>
        )}
        {activeCoverage && (activeCoverage.covered.length > 0 || activeCoverage.notCovered.length > 0) && (
          <Dialog>
            <DialogTrigger className={`inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted ${activeCoverage?.fuelPercent == null ? 'ml-auto' : ''}`}>
              ⓘ Phí cover / không cover
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Khoản phí matrix cover / không cover — {active}</DialogTitle>
              </DialogHeader>
              <p className="-mt-1 mb-1 text-xs text-muted-foreground">Số tiền/% theo công thức hệ thống đang áp hôm nay (fuel {activeCoverage.fuelPercent ?? '—'}%).</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
                  <div className="mb-1.5 font-medium text-emerald-700 dark:text-emerald-400">✓ Giá ĐÃ cover</div>
                  <ul className="space-y-1 text-muted-foreground">
                    {activeCoverage.covered.map((c, i) => (
                      <li key={i}>• {c.label}{c.detail && <span className="text-emerald-600/80 dark:text-emerald-400/80"> — {c.detail}</span>}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
                  <div className="mb-1.5 font-medium text-amber-700 dark:text-amber-400">⚠ KHÔNG cover (shop có thể gánh)</div>
                  <ul className="space-y-1 text-muted-foreground">
                    {activeCoverage.notCovered.length > 0
                      ? activeCoverage.notCovered.map((c, i) => (
                        <li key={i}>• {c.label}{c.detail && <span className="text-amber-600/80 dark:text-amber-400/80"> — {c.detail}</span>}</li>
                      ))
                      : <li>— (không có khoản nào ngoài bảng)</li>}
                  </ul>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="space-y-1">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã zone (ME1) / nước (SA, IL) / market — hoặc mốc cân (2kg, 0.5) để nhảy tới dòng"
          className="w-full max-w-xl rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {weight != null && (
          <p className="text-xs text-muted-foreground">Đang tô sáng bậc chứa <strong>{weight} kg</strong>.</p>
        )}
      </div>

      {cols.length === 0 || matrix.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có zone nào khớp “{q}”.</p>
      ) : (
        <div className="max-h-[78vh] w-fit max-w-full overflow-auto rounded-md border border-border">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-background px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bậc cân
                </th>
                {matrix.zoneNames.map((zn, idx) => {
                  const z = meta.get(zn);
                  const prevMarket = idx > 0 ? meta.get(matrix.zoneNames[idx - 1])?.market : null;
                  const firstOfMarket = z?.market !== prevMarket;
                  return (
                    <th
                      key={zn}
                      className={`sticky top-0 z-20 whitespace-nowrap border-b border-border bg-background px-3 py-1.5 text-right align-bottom ${firstOfMarket && idx > 0 ? 'border-l-2 border-l-border' : ''}`}
                      title={`${z?.market} · ${z?.label ?? zn}`}
                    >
                      <div className="text-[10px] font-normal normal-case text-muted-foreground/70">{firstOfMarket ? z?.market : ' '}</div>
                      <div className="text-sm font-semibold text-foreground">{zn}</div>
                      <div className="text-[10px] font-normal normal-case text-muted-foreground">{zoneCarrierLabel(z?.label ?? zn)}</div>
                      {z && z.countries.length > 0 && (() => {
                        const { shown, extra } = summarizeZoneCountries(z.countries, 6);
                        return (
                          <div
                            className="text-[10px] font-mono font-normal text-muted-foreground/80"
                            title={z.countries.join(' ')}
                          >
                            {shown.join(' ')}{extra > 0 ? ` … +${extra}` : ''}
                          </div>
                        );
                      })()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {matrix.rows.map((row) => {
                const hit = weight != null && bracketMatchesWeight(row.bracket, weight);
                return (
                  <tr key={row.bracket} ref={hit ? rowRef : undefined} className={hit ? 'bg-amber-500/15' : undefined}>
                    <th className={`sticky left-0 z-10 whitespace-nowrap border-b border-r border-border px-3 py-1 text-left font-sans font-normal ${hit ? 'bg-amber-500/15' : 'bg-background'}`}>
                      {row.bracket}
                    </th>
                    {row.cells.map((cell, i) => {
                      const zn = matrix.zoneNames[i];
                      const prevMarket = i > 0 ? meta.get(matrix.zoneNames[i - 1])?.market : null;
                      const firstOfMarket = meta.get(zn)?.market !== prevMarket;
                      return (
                        <td key={zn} className={`border-b border-border px-3 py-1 text-right ${firstOfMarket && i > 0 ? 'border-l-2 border-l-border' : ''}`}>
                          {cell ? fmtPrice(cell.price, cell.currency) : '—'}
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
    </div>
  );
}
