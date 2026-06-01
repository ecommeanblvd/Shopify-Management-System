'use client';

import { useTransition, useState } from 'react';

interface WishlistToggleProps {
  storeId: string;
  enabled: boolean;
  canManage: boolean;
  saveAction: (storeId: string, enabled: boolean) => Promise<void>;
}

/** iOS-style toggle pill bound to the per-store wishlist activation
 *  flag. Disables itself during the optimistic save so the operator
 *  can't double-click. */
export function WishlistToggle({ storeId, enabled, canManage, saveAction }: WishlistToggleProps) {
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
        // Roll back optimistic flip on failure.
        setOptimistic(!next);
      }
    });
  };

  const title = canManage
    ? optimistic ? 'Disable wishlist for this store' : 'Enable wishlist for this store'
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
        (optimistic ? 'bg-emerald-500' : 'bg-muted-foreground/30')
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
