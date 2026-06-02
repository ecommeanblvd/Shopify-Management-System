'use client';

import { useTransition, useState } from 'react';

interface SaveForLaterToggleProps {
  storeId: string;
  enabled: boolean;
  canManage: boolean;
  saveAction: (storeId: string, enabled: boolean) => Promise<void>;
}

export function SaveForLaterToggle({
  storeId, enabled, canManage, saveAction,
}: SaveForLaterToggleProps) {
  const [optimistic, setOptimistic] = useState(enabled);
  const [pending, startTransition] = useTransition();

  const onToggle = (): void => {
    if (!canManage || pending) return;
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      try { await saveAction(storeId, next); }
      catch { setOptimistic(!next); }
    });
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canManage || pending}
      aria-pressed={optimistic}
      className={
        'relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
        (optimistic ? 'bg-violet-500' : 'bg-muted-foreground/30')
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
