'use client';

import { useState, useTransition, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import type { PostcodeSearchResult } from '@/features/carrier-rates/postcodes-actions';

const ISO2_RE = /^[A-Z]{2}$/;
const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
function flag(code: string): string {
  if (!ISO2_RE.test(code)) return '🏳️';
  return [...code].map((c) => String.fromCodePoint(c.charCodeAt(0) + FLAG_OFFSET)).join('');
}
function fmtPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return '—';
  const f = from ? from.slice(0, 10) : '…';
  return `${f} → ${to ? to.slice(0, 10) : '∞'}`;
}

type SearchAction = (query: string, opts: { period?: string | null }) => Promise<PostcodeSearchResult>;

/** Free-text remote lookup across all countries (postcode / town / tier).
 *  Calls the bound server action; debounced so typing doesn't spam the DB. */
export function RemotePostcodeSearch({ search, period }: { search: SearchAction; period?: string | null }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<PostcodeSearchResult | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setRes(null); return; }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const r = await search(value.trim(), { period: period ?? null });
        setRes(r);
      });
    }, 250);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
          placeholder="Tìm postcode / thành phố / tier (vd: 150-0012, Buraydah, Tier B)…"
          className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-sm outline-none focus:border-foreground/40"
        />
      </div>

      {res && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <span>{res.total.toLocaleString()} kết quả{period ? ' (trong kỳ đang lọc)' : ''}</span>
            {res.truncated && <span>hiển thị {res.rows.length} đầu tiên — gõ cụ thể hơn để thu hẹp</span>}
          </div>
          {res.rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground italic">Không khớp entry remote nào.</div>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-border overflow-auto">
              {res.rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-muted/30">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="text-lg leading-none" aria-hidden>{flag(r.countryCode)}</span>
                    <span className="font-mono tabular-nums">{r.postcodePattern}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{r.countryCode}</span>
                    {r.tier && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">{r.tier}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{fmtPeriod(r.effectiveFrom, r.effectiveTo)}</span>
                    {r.source && <span className="hidden max-w-[14rem] truncate sm:inline">{r.source}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
