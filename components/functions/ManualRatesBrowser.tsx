'use client';

import { useMemo, useState } from 'react';
import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';
import { parseRateSearch, buildMarketCodes } from '@/features/markets/domain/shipping-matrix-view';
import { MarketRateMatrix } from './MarketRateMatrix';

export interface MarketZones { marketHandle: string; zones: ZoneView[]; }

export function ManualRatesBrowser({ markets }: { markets: MarketZones[] }) {
  const [q, setQ] = useState('');
  const { needle, weight } = parseRateSearch(q);

  // Mã market ngắn cho badge tiêu đề (mã zone ME1/US1… đã nằm sẵn trong key zone của data).
  const codes = useMemo(() => buildMarketCodes(markets.map((m) => m.marketHandle)), [markets]);

  // needle lọc CỘT zone (theo mã zone / nhãn carrier-zone / mã nước / market). weight không lọc — chỉ highlight dòng.
  const filtered = markets
    .map((m) => ({
      marketHandle: m.marketHandle,
      marketCode: codes[m.marketHandle],
      zones:
        needle === '' || m.marketHandle.toLowerCase().includes(needle)
          ? m.zones
          : m.zones.filter(
              (z) =>
                z.zoneName.toLowerCase().includes(needle) ||
                (z.label ?? '').toLowerCase().includes(needle) ||
                z.countries.some((c) => c.toLowerCase().includes(needle)),
            ),
    }))
    .filter((m) => m.zones.length > 0);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm zone / mã nước / market (vd: SA, japan) — hoặc mốc cân để nhảy tới dòng (vd: 2kg, 0.5)"
          className="w-full max-w-xl rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {weight != null && (
          <p className="text-xs text-muted-foreground">Đang tô sáng bậc chứa <strong>{weight} kg</strong>.</p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có zone nào khớp “{q}”.</p>
      ) : (
        filtered.map((m) => (
          <section key={m.marketHandle} className="space-y-3">
            <h2 className="text-lg font-medium">
              <span className="font-mono text-sm rounded bg-muted px-1.5 py-0.5 text-muted-foreground mr-2">{m.marketCode}</span>
              {m.marketHandle}
            </h2>
            <MarketRateMatrix zones={m.zones} highlightWeight={weight} />
          </section>
        ))
      )}
    </div>
  );
}
