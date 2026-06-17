'use client';

import { useMemo, useState } from 'react';
import { Search, Globe } from 'lucide-react';
import type { SystemZoneRow } from '@/features/carrier-rates/zone-matrix';

/**
 * Bảng zone HỆ THỐNG (dạng thẻ): mỗi zone = 1 card — mã vùng (ME1/EU1/…),
 * zone FedEx/DHL gốc, danh sách quốc gia (cờ + tên). Search theo nước / ISO /
 * mã zone / zone FedEx/DHL.
 */
export function ZoneReferenceTable({ rows }: { rows: SystemZoneRow[] }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.zone.toLowerCase().includes(s) ||
        (r.fedexZone ?? '').toLowerCase().includes(s) ||
        (r.dhlZone ?? '').toLowerCase().includes(s) ||
        r.countries.some((c) => c.name.toLowerCase().includes(s) || c.iso.toLowerCase().includes(s)),
    );
  }, [rows, s]);

  if (rows.length === 0) return null;
  const totalCountries = rows.reduce((n, r) => n + r.countries.length, 0);
  const isMatch = (c: { iso: string; name: string }) =>
    !!s && (c.name.toLowerCase().includes(s) || c.iso.toLowerCase().includes(s));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Globe className="size-4" /> Zones · Country → Zone
          <span className="font-normal normal-case">
            ({filtered.length}/{rows.length} zone · {totalCountries} nước)
          </span>
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo nước / ISO / zone (vd: United States, US, ME1, Zone H)"
            className="w-80 rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          Không thấy khớp “{q}”.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((r) => (
            <div key={r.zone} className="rounded-xl border border-border bg-card/40 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-base font-semibold tracking-tight">{r.zone}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({r.fedexZone ? `FedEx ${r.fedexZone}` : 'FedEx —'} / {r.dhlZone ? `DHL ${r.dhlZone}` : 'DHL —'})
                  </span>
                </div>
                <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {r.countries.length} {r.countries.length === 1 ? 'country' : 'countries'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.countries.length === 0 ? (
                  <span className="text-xs italic text-muted-foreground">Chưa có country.</span>
                ) : (
                  r.countries.map((c) => (
                    <span
                      key={c.iso}
                      title={`${c.name} (${c.iso})`}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm ${
                        isMatch(c) ? 'border-ring bg-ring/15' : 'border-border bg-muted/30'
                      }`}
                    >
                      <span className="text-base leading-none">{c.flag || '🏳️'}</span>
                      <span className="whitespace-nowrap">{c.name}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
