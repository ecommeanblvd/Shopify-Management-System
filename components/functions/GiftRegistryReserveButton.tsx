'use client';

import { useState } from 'react';
import { Gift } from 'lucide-react';
import type { GiftRegistryMessages } from '@/features/functions/gift-registry/i18n';

interface GiftRegistryReserveButtonProps {
  token: string;
  itemId: string;
  remaining: number;
  msg: GiftRegistryMessages['viewerPage'];
}

/** Interactive reservation flow on the public viewer page. */
export function GiftRegistryReserveButton({
  token, itemId, remaining, msg,
}: GiftRegistryReserveButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mt-3 px-3 py-2 rounded-md bg-emerald-50 text-emerald-700 text-xs">
        {msg.reservedSuccess}
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div className="mt-3 inline-block px-3 py-1 rounded-full bg-neutral-100 text-neutral-500 text-[10px] font-semibold uppercase tracking-wider">
        {msg.fullyReservedBadge}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-neutral-200 hover:bg-neutral-50 transition-colors"
      >
        <Gift className="size-3.5" />
        {msg.reserveCta}
      </button>
    );
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await fetch(`/api/storefront/gift-registry/${token}/items/${itemId}/reserve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reserverName: name,
          reserverEmail: email,
          qty,
          message: message || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || msg.errorGeneric);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : msg.errorGeneric);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 p-3 rounded-md border border-neutral-200 bg-neutral-50/60">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder={msg.yourNamePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          className="text-xs px-2 py-1.5 rounded border border-neutral-200 bg-white"
        />
        <input
          type="email"
          placeholder={msg.yourEmailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="text-xs px-2 py-1.5 rounded border border-neutral-200 bg-white"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-neutral-500">
          {msg.qtyLabel}
          <input
            type="number"
            min={1}
            max={remaining}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(remaining, Number(e.target.value))))}
            className="ml-1.5 w-14 text-xs px-2 py-1 rounded border border-neutral-200 bg-white"
          />
        </label>
        <span className="text-[10px] text-neutral-400">
          {msg.remainingLabel(remaining)}
        </span>
      </div>
      <textarea
        placeholder={msg.notePlaceholder}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={500}
        rows={2}
        className="w-full text-xs px-2 py-1.5 rounded border border-neutral-200 bg-white"
      />
      {error && <div className="text-[11px] text-rose-600">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-neutral-900 text-white disabled:opacity-50"
        >
          {pending ? msg.reserving : msg.reserveSubmit}
        </button>
      </div>
    </form>
  );
}
