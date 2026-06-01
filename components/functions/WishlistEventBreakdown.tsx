import type { WishlistEventBucket } from '@/features/functions/wishlist/admin-actions';

interface WishlistEventBreakdownProps {
  buckets: WishlistEventBucket[];
  days: number;
}

const EVENT_LABELS: Record<string, string> = {
  add: 'Items saved',
  remove: 'Items removed',
  merge: 'Guest → email merges',
  share: 'Share links created',
  view: 'Share page views',
};

const EVENT_ACCENT: Record<string, string> = {
  add: 'bg-emerald-500',
  remove: 'bg-rose-500',
  merge: 'bg-amber-500',
  share: 'bg-blue-500',
  view: 'bg-violet-500',
};

/** Horizontal bar chart of wishlist events over the last N days. Kept
 *  as a pure server component — no clientside chart library. */
export function WishlistEventBreakdown({ buckets, days }: WishlistEventBreakdownProps) {
  if (buckets.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        No wishlist activity in the last {days} days yet.
      </div>
    );
  }
  const max = Math.max(...buckets.map((b) => b.count));
  return (
    <ul className="divide-y divide-border">
      {buckets.map((b) => {
        const label = EVENT_LABELS[b.eventType] ?? b.eventType;
        const accent = EVENT_ACCENT[b.eventType] ?? 'bg-muted-foreground';
        const widthPct = max > 0 ? Math.max(2, Math.round((b.count / max) * 100)) : 0;
        return (
          <li key={b.eventType} className="px-5 py-3 flex items-center gap-4">
            <div className="w-32 shrink-0 text-xs">{label}</div>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${accent} transition-[width] duration-300`} style={{ width: `${widthPct}%` }} />
            </div>
            <div className="w-12 text-right font-mono tabular-nums text-sm font-semibold shrink-0">
              {b.count.toLocaleString()}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
