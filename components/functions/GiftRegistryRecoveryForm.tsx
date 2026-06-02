'use client';

import { useState } from 'react';
import { Gift, ExternalLink, Search } from 'lucide-react';

interface FoundRegistry {
  shareToken: string;
  eventName: string;
  eventDate: string | null;
  itemCount: number;
  createdAt: string;
}

interface GiftRegistryRecoveryFormProps {
  shopDomain: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  } catch { return iso; }
}

export function GiftRegistryRecoveryForm({ shopDomain }: GiftRegistryRecoveryFormProps) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundRegistry[] | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setPending(true);
    setFound(null);
    try {
      const r = await fetch(
        `/api/storefront/gift-registry/find-by-owner?shop=${encodeURIComponent(shopDomain)}&email=${encodeURIComponent(email)}`,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || 'Lookup failed');
      setFound(data.registries || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label className="text-xs uppercase tracking-wider text-neutral-500">
          Your email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full text-sm px-3 py-2.5 rounded-md border border-neutral-200 bg-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          <Search className="size-4" />
          {pending ? 'Looking up…' : 'Find my registries'}
        </button>
      </form>

      {error && <div className="text-sm text-rose-600">{error}</div>}

      {found !== null && (
        <div className="space-y-3">
          {found.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white py-10 px-6 text-center text-sm text-neutral-500">
              No registries found for <span className="font-mono">{email}</span>.
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-500 text-center">
                Found {found.length} registr{found.length === 1 ? 'y' : 'ies'}:
              </p>
              <ul className="space-y-2">
                {found.map((reg) => (
                  <li key={reg.shareToken}>
                    <a
                      href={`/gr/${reg.shareToken}`}
                      className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-white hover:bg-amber-50/40 hover:border-amber-300 transition-colors group"
                    >
                      <div className="size-9 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <Gift className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{reg.eventName}</div>
                        <div className="text-xs text-neutral-500 flex items-center gap-1.5 mt-0.5">
                          {reg.eventDate && <span>{formatDate(reg.eventDate)}</span>}
                          {reg.eventDate && <span>·</span>}
                          <span className="tabular-nums">
                            {reg.itemCount} item{reg.itemCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <ExternalLink className="size-4 text-neutral-400 group-hover:text-amber-600 transition-colors" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
