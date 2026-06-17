'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ZoneMatrixRow } from '@/features/carrier-rates/zone-matrix';

/**
 * Bảng tham chiếu zone: tra 1 nước thuộc zone nào của FedEx & DHL (theo phân
 * chia zone đã set up) — phục vụ lúc set up giá ship thủ công.
 */
export function ZoneReferenceTable({ rows }: { rows: ZoneMatrixRow[] }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s) || r.iso.toLowerCase().includes(s));
  }, [rows, q]);

  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">
          Bảng Zone <span className="font-normal text-muted-foreground">— FedEx ↔ DHL theo nước ({filtered.length})</span>
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo nước / mã ISO (vd: United States, US)"
            className="w-72 rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Nước</th>
              <th className="px-3 py-2 text-left font-medium w-16">ISO</th>
              <th className="px-3 py-2 text-left font-medium">FedEx zone</th>
              <th className="px-3 py-2 text-left font-medium">DHL zone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Không thấy nước khớp “{q}”.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.iso} className="hover:bg-muted/20">
                <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.iso}</td>
                <td className="px-3 py-2">
                  {r.fedexZone ?? <span className="text-muted-foreground/50 text-xs italic">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.dhlZone ?? <span className="text-muted-foreground/50 text-xs italic">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
