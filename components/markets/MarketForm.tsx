'use client';

import { useState } from 'react';
import type { Market } from '@/features/markets/types';

interface Props {
  initial: Market;
  isNew: boolean;
  onSubmit: (m: Market) => Promise<void>;
}

export function MarketForm({ initial, isNew, onSubmit }: Props) {
  const [m, setM] = useState<Market>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit(m);
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-6 max-w-2xl"
    >
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Handle</span>
          <input
            type="text"
            disabled={!isNew}
            value={m.handle}
            onChange={(e) => setM({ ...m, handle: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2 disabled:bg-muted"
            pattern="[a-z0-9-]+"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            type="text"
            value={m.name}
            onChange={(e) => setM({ ...m, name: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2"
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Type</span>
        <select
          value={m.type}
          onChange={(e) => setM({ ...m, type: e.target.value as 'regional' | 'international' })}
          className="mt-1 block w-full rounded border px-3 py-2"
        >
          <option value="regional">Regional</option>
          <option value="international">International (catch-all)</option>
        </select>
      </label>

      {m.type === 'regional' && (
        <label className="block">
          <span className="text-sm font-medium">Countries (ISO-2, comma-separated)</span>
          <input
            type="text"
            value={m.countries.join(', ')}
            onChange={(e) => setM({
              ...m,
              countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
            placeholder="DE, FR, IT"
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Primary currency</span>
          <input
            type="text"
            value={m.primaryCurrency}
            onChange={(e) => setM({ ...m, primaryCurrency: e.target.value.toUpperCase() })}
            className="mt-1 block w-full rounded border px-3 py-2"
            pattern="[A-Z]{3}"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Alt currencies (comma)</span>
          <input
            type="text"
            value={m.alternativeCurrencies.join(', ')}
            onChange={(e) => setM({
              ...m,
              alternativeCurrencies: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Primary language</span>
          <input
            type="text"
            value={m.primaryLanguage}
            onChange={(e) => setM({ ...m, primaryLanguage: e.target.value.toLowerCase() })}
            className="mt-1 block w-full rounded border px-3 py-2"
            pattern="[a-z]{2}"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Alt languages (comma)</span>
          <input
            type="text"
            value={m.alternativeLanguages.join(', ')}
            onChange={(e) => setM({
              ...m,
              alternativeLanguages: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
            })}
            className="mt-1 block w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={m.enabled}
          onChange={(e) => setM({ ...m, enabled: e.target.checked })}
        />
        <span className="text-sm">Enabled</span>
      </label>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : isNew ? 'Create market' : 'Save changes'}
      </button>
    </form>
  );
}
