'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Auto-refreshes the (server-rendered, force-dynamic) sync-health page while a
 * backfill is running, so live progress advances without a manual reload. Calls
 * router.refresh() on an interval — this re-runs the server component and swaps
 * in fresh data, no full navigation. Idle when nothing is running to avoid
 * pointless server hits.
 */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }): React.ReactElement | null {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      router.refresh();
      setTick((t) => t + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      Tự cập nhật mỗi {Math.round(intervalMs / 1000)}s{tick > 0 ? ` · ${tick}` : ''}
    </span>
  );
}
