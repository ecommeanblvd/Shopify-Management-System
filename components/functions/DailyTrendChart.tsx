/**
 * Pure server-rendered daily activity chart. 7 vertical bars, one per
 * day, height proportional to the day's count. No client JS, no chart
 * library. Used by Recently Viewed + Save for later where there's only
 * one event type so a stacked / horizontal breakdown doesn't help.
 */

export interface DailyBucket {
  /** YYYY-MM-DD in UTC. */
  day: string;
  count: number;
}

interface DailyTrendChartProps {
  buckets: DailyBucket[];
  /** Tailwind class for the bar fill. Defaults to muted-foreground. */
  accentClass?: string;
  /** Label shown when every bar is zero. */
  emptyLabel?: string;
}

function shortLabel(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      weekday: 'short', timeZone: 'UTC',
    });
  } catch {
    return iso.slice(5);
  }
}

export function DailyTrendChart({
  buckets, accentClass = 'bg-muted-foreground',
  emptyLabel = 'No activity in this window yet.',
}: DailyTrendChartProps) {
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  if (total === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  const max = Math.max(...buckets.map((b) => b.count));
  return (
    <div className="px-5 py-5">
      <div className="flex items-end gap-2 h-32">
        {buckets.map((b) => {
          const heightPct = max > 0 ? Math.max(2, Math.round((b.count / max) * 100)) : 0;
          return (
            <div key={b.day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="flex-1 w-full flex items-end">
                <div
                  className={`w-full ${accentClass} rounded-sm transition-[height] duration-300`}
                  style={{ height: `${heightPct}%` }}
                  title={`${b.day}: ${b.count.toLocaleString()}`}
                />
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {shortLabel(b.day)}
              </div>
              <div className="text-[11px] font-mono tabular-nums font-medium">
                {b.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
