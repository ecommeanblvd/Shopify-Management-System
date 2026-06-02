/**
 * Cross-store activity table for a single function. Renders one row
 * per store with the activity counters from `getCrossStoreActivity`.
 *
 * Pure server component; no client JS.
 */

import Link from 'next/link';
import { ExternalLink, Power } from 'lucide-react';
import type { StoreActivityRow } from '@/features/functions/cross-store';

interface CrossStoreActivityTableProps {
  rows: StoreActivityRow[];
  /** Per-store admin route prefix, e.g. "/f/functions/wishlist". */
  adminPathPrefix: string;
  /** Tailwind class for the active-pill dot. Aligns with each
   *  function's accent colour. */
  accentDot?: string;
}

function formatRelative(d: Date | null): string {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function CrossStoreActivityTable({
  rows, adminPathPrefix, accentDot = 'text-emerald-500',
}: CrossStoreActivityTableProps) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        No store has activity for this function yet.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.storeId} className="px-5 py-3 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium truncate">{r.storeName}</h3>
              {r.enabled ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <Power className={`size-2.5 ${accentDot}`} />
                  active
                </span>
              ) : (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  inactive
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">{r.shopDomain}</p>
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last 7d</div>
            <div className="font-mono tabular-nums text-sm font-semibold">{r.events7d.toLocaleString()}</div>
          </div>
          <div className="hidden md:block text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime</div>
            <div className="font-mono tabular-nums text-sm">{r.totalEvents.toLocaleString()}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last seen</div>
            <div className="text-xs font-mono tabular-nums">{formatRelative(r.lastEventAt)}</div>
          </div>
          {r.enabled && (
            <Link
              href={`${adminPathPrefix}/${r.storeId}`}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
            >
              Open
              <ExternalLink className="size-3" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
