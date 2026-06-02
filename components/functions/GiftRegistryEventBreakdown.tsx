import type { GiftRegistryEventBucket } from '@/features/functions/gift-registry/admin-actions';

interface GiftRegistryEventBreakdownProps {
  buckets: GiftRegistryEventBucket[];
  days: number;
}

const EVENT_LABELS: Record<string, string> = {
  registry_created: 'Registries created',
  item_added: 'Items added',
  reservation_made: 'Reservations made',
  reservation_cancelled: 'Reservations cancelled',
};

const EVENT_ACCENT: Record<string, string> = {
  registry_created: 'bg-amber-500',
  item_added: 'bg-emerald-500',
  reservation_made: 'bg-sky-500',
  reservation_cancelled: 'bg-rose-500',
};

/** Horizontal bar chart of gift-registry activity over the last N
 *  days. The "events" are synthesised at query time from the
 *  registries / items / reservations tables (no dedicated events
 *  log) — see `getGiftRegistryEventBreakdown`. */
export function GiftRegistryEventBreakdown({ buckets, days }: GiftRegistryEventBreakdownProps) {
  if (buckets.every((b) => b.count === 0)) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        No registry activity in the last {days} days yet.
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
            <div className="w-40 shrink-0 text-xs">{label}</div>
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
