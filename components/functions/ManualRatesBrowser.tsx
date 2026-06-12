'use client';

import { useState } from 'react';
import type { ZoneView } from '@/features/markets/domain/shipping-matrix-view';
import { ShippingMatrixTable } from './ShippingMatrixTable';

export interface MarketZones { marketHandle: string; zones: ZoneView[]; }

export function ManualRatesBrowser({ markets }: { markets: MarketZones[] }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const filtered = markets
    .map((m) => ({
      marketHandle: m.marketHandle,
      zones: needle === '' ? m.zones : m.zones.filter((z) =>
        z.zoneName.toLowerCase().includes(needle) ||
        m.marketHandle.toLowerCase().includes(needle) ||
        z.countries.some((c) => c.toLowerCase().includes(needle))),
    }))
    .filter((m) => m.zones.length > 0);

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm theo zone / mã nước / market… (vd: SA, FedEx H, japan)"
        className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có zone nào khớp “{q}”.</p>
      ) : (
        filtered.map((m) => (
          <section key={m.marketHandle} className="space-y-3">
            <h2 className="text-lg font-medium">{m.marketHandle}</h2>
            <ShippingMatrixTable zones={m.zones} />
          </section>
        ))
      )}
    </div>
  );
}
