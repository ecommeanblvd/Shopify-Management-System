/**
 * 7-day stacked activity chart for the Functions overview.
 *
 * Pure server component: each daily bar is a flex column with one
 * coloured slice per function, height proportional to the day's total.
 * No client JS, no chart library.
 *
 * The accent colours come from the function manifest so adding a new
 * function automatically picks up its colour here.
 */

import type { FunctionManifest } from '@/lib/registry/functions';
import type { ActivityDayBucket } from '@/features/functions/activity-trend';

interface ActivityStackedChartProps {
  buckets: ActivityDayBucket[];
  functions: readonly FunctionManifest[];
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

/** Tailwind background classes per function key, kept aligned with the
 *  manifest accent so adding a new function picks up its colour
 *  automatically. Falls back to muted-foreground for unknown keys. */
const STACK_BG: Record<string, string> = {
  wishlist: 'bg-rose-500',
  'recently-viewed': 'bg-sky-500',
  'gift-registry': 'bg-amber-500',
  'save-for-later': 'bg-violet-500',
};

const LEGEND_DOT: Record<string, string> = STACK_BG;

export function ActivityStackedChart({ buckets, functions }: ActivityStackedChartProps) {
  const grandTotal = buckets.reduce(
    (acc, b) => acc + Object.values(b.byFunction).reduce((s, n) => s + n, 0),
    0,
  );
  if (grandTotal === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted-foreground">
        No activity recorded across any function in the last {buckets.length} days yet.
      </div>
    );
  }
  const dailyTotals = buckets.map((b) => Object.values(b.byFunction).reduce((s, n) => s + n, 0));
  const max = Math.max(...dailyTotals);
  const orderedKeys = functions.map((f) => f.key);

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-end gap-2 h-40">
        {buckets.map((bucket, i) => {
          const total = dailyTotals[i] ?? 0;
          const heightPct = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
          return (
            <div key={bucket.day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="flex-1 w-full flex items-end" title={`${bucket.day}: ${total.toLocaleString()}`}>
                <div
                  className="w-full flex flex-col-reverse overflow-hidden rounded-sm transition-[height] duration-300"
                  style={{ height: `${heightPct}%` }}
                >
                  {orderedKeys.map((key) => {
                    const value = bucket.byFunction[key] ?? 0;
                    if (value === 0) return null;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    return (
                      <div
                        key={key}
                        className={STACK_BG[key] ?? 'bg-muted-foreground'}
                        style={{ height: `${pct}%` }}
                        title={`${key}: ${value.toLocaleString()}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {shortLabel(bucket.day)}
              </div>
              <div className="text-[11px] font-mono tabular-nums font-medium">
                {total.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-border">
        {functions.map((fn) => (
          <li key={fn.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`inline-block size-2 rounded-full ${LEGEND_DOT[fn.key] ?? 'bg-muted-foreground'}`} />
            <span>{fn.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
