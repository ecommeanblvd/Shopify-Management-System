'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface GiftRegistryCreateFormProps {
  shopDomain: string;
}

export function GiftRegistryCreateForm({ shopDomain }: GiftRegistryCreateFormProps) {
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await fetch(
        `/api/storefront/gift-registry?shop=${encodeURIComponent(shopDomain)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ownerEmail,
            ownerName: ownerName || undefined,
            eventName,
            eventDate: eventDate || undefined,
            message: message || undefined,
          }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || 'Could not create registry');
      setResult({ url: data.url, token: data.shareToken });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create registry');
    } finally {
      setPending(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <div className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold uppercase tracking-wider">
          Registry created
        </div>
        <h2 className="text-2xl font-semibold">Your share link</h2>
        <p className="text-sm text-neutral-600 max-w-md mx-auto">
          Save this link — it&rsquo;s how guests view and reserve items
          on your registry. Keep it handy; we don&rsquo;t require an
          account.
        </p>
        <div className="flex items-center gap-2 max-w-md mx-auto p-3 rounded-lg border border-neutral-200 bg-white">
          <code className="flex-1 text-xs font-mono truncate text-neutral-700 text-left">
            {result.url}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(result.url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900 transition-colors shrink-0"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <a
          href={result.url}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:text-amber-900"
        >
          Open your registry
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Your email" hint="So we can find your registry later if you lose the link.">
        <input
          type="email"
          required
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 bg-white"
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Your name (optional)">
        <input
          type="text"
          maxLength={120}
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 bg-white"
        />
      </Field>
      <Field label="Event name" hint="What's the registry for?">
        <input
          type="text"
          required
          maxLength={200}
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 bg-white"
          placeholder="Jane &amp; John's Wedding"
        />
      </Field>
      <Field label="Event date (optional)">
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 bg-white"
        />
      </Field>
      <Field label="A note for guests (optional)">
        <textarea
          maxLength={2000}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 bg-white"
          placeholder="Thanks for celebrating with us!"
        />
      </Field>
      {error && <div className="text-sm text-rose-600">{error}</div>}
      <button
        type="submit"
        disabled={pending}
        className="w-full text-sm font-medium px-4 py-2.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Creating…' : 'Create registry'}
      </button>
    </form>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-neutral-500">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}
