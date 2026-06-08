'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function RateCardWindowEdit({
  effectiveFrom,
  effectiveTo,
  updateAction,
}: {
  effectiveFrom: string;
  effectiveTo: string | null;
  updateAction: (input: { effectiveFrom: string; effectiveTo: string | null }) => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(effectiveFrom);
  const [to, setTo] = useState(effectiveTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs underline text-muted-foreground hover:text-foreground whitespace-nowrap">
        Edit window
      </button>
    );
  }

  function onSave() {
    setError(null);
    start(async () => {
      try {
        await updateAction({ effectiveFrom: from, effectiveTo: to.trim() || null });
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex items-end gap-2">
      <label className="text-[10px] space-y-0.5">
        <span className="block text-muted-foreground uppercase tracking-wider">From</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block rounded-md border border-border bg-card px-2 py-1 text-xs" />
      </label>
      <label className="text-[10px] space-y-0.5">
        <span className="block text-muted-foreground uppercase tracking-wider">To (blank = open)</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block rounded-md border border-border bg-card px-2 py-1 text-xs" />
      </label>
      <Button onClick={onSave} disabled={pending || !from} variant="outline" className="h-8">
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <Button onClick={() => { setEditing(false); setFrom(effectiveFrom); setTo(effectiveTo ?? ''); setError(null); }} variant="ghost" className="h-8">
        Cancel
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
