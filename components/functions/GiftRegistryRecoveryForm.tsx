'use client';

import { useState } from 'react';
import { Gift, ExternalLink, Search } from 'lucide-react';
import type { GiftRegistryMessages } from '@/features/functions/gift-registry/i18n';

interface FoundRegistry {
  shareToken: string;
  eventName: string;
  eventDate: string | null;
  itemCount: number;
  createdAt: string;
}

interface GiftRegistryRecoveryFormProps {
  shopDomain: string;
  msg: GiftRegistryMessages['findPage'];
  /** ?lang= to preserve when linking to viewer. */
  lang: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  } catch { return iso; }
}

export function GiftRegistryRecoveryForm({
  shopDomain, msg, lang,
}: GiftRegistryRecoveryFormProps) {
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
      if (!r.ok) throw new Error(data?.message || msg.errorGeneric);
      setFound(data.registries || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : msg.errorGeneric);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label className="text-xs uppercase tracking-wider text-neutral-500">
          {msg.yourEmailLabel}
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={msg.yourEmailPlaceholder}
          className="w-full text-sm px-3 py-2.5 rounded-md border border-neutral-200 bg-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          <Search className="size-4" />
          {pending ? msg.submitting : msg.submitButton}
        </button>
      </form>

      {error && <div className="text-sm text-rose-600">{error}</div>}

      {found !== null && (
        <div className="space-y-3">
          {found.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white py-10 px-6 text-center text-sm text-neutral-500">
              {msg.noneFound(email)}
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-500 text-center">
                {msg.foundHeading(found.length)}
              </p>
              <ul className="space-y-2">
                {found.map((reg) => (
                  <li key={reg.shareToken}>
                    <a
                      href={`/gr/${reg.shareToken}?lang=${encodeURIComponent(lang)}`}
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
                          <span className="tabular-nums">{msg.itemsLabel(reg.itemCount)}</span>
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
