'use client';

import { useTransition, useState } from 'react';

interface RecentlyViewedToggleProps {
  storeId: string;
  enabled: boolean;
  canManage: boolean;
  saveAction: (storeId: string, enabled: boolean) => Promise<void>;
}

/** iOS-style pill toggle for the per-store Recently Viewed activation
 *  flag. Identical UX to the wishlist toggle — kept as a separate
 *  component so each function can evolve its disabled-state styling. */
export function RecentlyViewedToggle({
  storeId, enabled, canManage, saveAction,
}: RecentlyViewedToggleProps) {
  const [optimistic, setOptimistic] = useState(enabled);
  const [pending, startTransition] = useTransition();

  const onToggle = (): void => {
    if (!canManage || pending) return;
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await saveAction(storeId, next);
      } catch {
        setOptimistic(!next);
      }
    });
  };

  const title = canManage
    ? optimistic ? 'Disable Recently Viewed for this store' : 'Enable Recently Viewed for this store'
    : 'You need the manage_functions permission to toggle this';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canManage || pending}
      aria-pressed={optimistic}
      title={title}
      className={
        'relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
        (optimistic ? 'bg-sky-500' : 'bg-muted-foreground/30')
      }
    >
      <span
        className={
          'absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ' +
          (optimistic ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
