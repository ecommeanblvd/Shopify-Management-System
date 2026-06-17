'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { SystemZoneRow } from '@/features/carrier-rates/zone-matrix';

/**
 * Bảng zone HỆ THỐNG: mỗi zone kết hợp (FedEx×DHL) + danh sách quốc gia trong
 * zone. Tra 1 nước thuộc zone hệ thống nào (search theo nước / ISO / tên zone).
 */
export function ZoneReferenceTable({ rows }: { rows: SystemZoneRow[] }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.zone.toLowerCase().includes(s) ||
        r.countries.some((c) => c.name.toLowerCase().includes(s) || c.iso.toLowerCase().includes(s)),
    );
  }, [rows, s]);

  if (rows.length === 0) return null;
  const totalCountries = rows.reduce((n, r) => n + r.countries.length, 0);
  const isMatch = (c: { iso: string; name: string }) =>
    !!s && (c.name.toLowerCase().includes(s) || c.iso.toLowerCase().includes(s));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">
          Bảng Zone hệ thống{' '}
          <span className="font-normal text-muted-foreground">
            — {filtered.length}/{rows.length} zone · {totalCountries} nước
          </span>
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo nước / mã ISO / zone (vd: United States, US, Zone H)"
            className="w-80 rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium w-44">Zone hệ thống</th>
              <th className="px-3 py-2 text-left font-medium w-16">Số nước</th>
              <th className="px-3 py-2 text-left font-medium">Quốc gia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Không thấy khớp “{q}”.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.zone} className="hover:bg-muted/20 align-top">
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{r.zone}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.countries.length}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.countries.map((c) => (
                        <span
                          key={c.iso}
                          title={c.name}
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
                            isMatch(c) ? 'border-ring bg-ring/15' : 'border-border bg-muted/30'
                          }`}
                        >
                          <span className="font-mono text-muted-foreground">{c.iso}</span>
                          {c.name !== c.iso && <span>{c.name}</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
