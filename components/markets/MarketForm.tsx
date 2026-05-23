'use client';

import { useState } from 'react';
import { Globe, Coins, Languages, Hash, Save, AlertCircle, Check, X } from 'lucide-react';
import type { Market } from '@/features/markets/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  initial: Market;
  isNew: boolean;
  onSubmit: (m: Market) => Promise<void>;
}

const ISO2_RE = /^[A-Z]{2}$/;

export function MarketForm({ initial, isNew, onSubmit }: Props) {
  const [m, setM] = useState<Market>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const countryChips = m.countries.filter((c) => ISO2_RE.test(c));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit(m);
          setSavedAt(new Date());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-10"
    >
      <Section icon={<Hash className="size-4" />} title="Identity" hint="Stable handle and human-friendly name.">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-5">
          <Field label="Handle" hint={isNew ? 'Lowercase, hyphenated. Permanent once set.' : 'Locked after creation.'}>
            <Input
              type="text"
              disabled={!isNew}
              value={m.handle}
              onChange={(e) => setM({ ...m, handle: e.target.value })}
              className="font-mono tracking-tight"
              pattern="[a-z0-9-]+"
              required
            />
          </Field>
          <Field label="Display name">
            <Input
              type="text"
              value={m.name}
              onChange={(e) => setM({ ...m, name: e.target.value })}
              required
            />
          </Field>
        </div>
      </Section>

      <Section icon={<Globe className="size-4" />} title="Region" hint="What this market covers in Shopify's geography model.">
        <div className="space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Market type</Label>
            <div className="inline-flex rounded-xl border border-input bg-input/30 p-1">
              <TypeOption
                value="regional"
                current={m.type}
                onSelect={(v) => setM({ ...m, type: v })}
                label="Regional"
                hint="Specific country list"
              />
              <TypeOption
                value="international"
                current={m.type}
                onSelect={(v) => setM({ ...m, type: v })}
                label="International"
                hint="Catch-all for everywhere else"
              />
            </div>
          </div>

          {m.type === 'regional' && (
            <Field
              label="Countries"
              hint="ISO-2 codes, comma-separated. Validated chips appear below."
            >
              <Input
                type="text"
                value={m.countries.join(', ')}
                onChange={(e) => setM({
                  ...m,
                  countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
                })}
                placeholder="DE, FR, IT, ES"
                className="font-mono"
              />
              {countryChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {countryChips.map((c) => (
                    <Badge key={c} variant="secondary" className="h-6 px-2 font-mono">{c}</Badge>
                  ))}
                </div>
              )}
              {m.countries.length > 0 && countryChips.length !== m.countries.length && (
                <p className="text-xs text-destructive mt-2 flex items-center gap-1.5">
                  <AlertCircle className="size-3" />
                  Some entries aren&rsquo;t valid ISO-2 codes — they&rsquo;ll be rejected on save.
                </p>
              )}
            </Field>
          )}
        </div>
      </Section>

      <Section icon={<Coins className="size-4" />} title="Currency" hint="Primary is what prices display in. Alts allow buyer-side switching.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Primary currency" hint="ISO-4217 code">
            <Input
              type="text"
              value={m.primaryCurrency}
              onChange={(e) => setM({ ...m, primaryCurrency: e.target.value.toUpperCase() })}
              className="font-mono uppercase tracking-widest"
              pattern="[A-Z]{3}"
              maxLength={3}
              required
            />
          </Field>
          <Field label="Alternative currencies" hint="Optional, comma-separated">
            <Input
              type="text"
              value={m.alternativeCurrencies.join(', ')}
              onChange={(e) => setM({
                ...m,
                alternativeCurrencies: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
              })}
              className="font-mono uppercase tracking-widest"
              placeholder="EUR, GBP"
            />
          </Field>
        </div>
      </Section>

      <Section icon={<Languages className="size-4" />} title="Language" hint="Primary drives storefront copy; alts are buyer-selectable.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Primary language" hint="ISO-639-1 code (2 letters)">
            <Input
              type="text"
              value={m.primaryLanguage}
              onChange={(e) => setM({ ...m, primaryLanguage: e.target.value.toLowerCase() })}
              className="font-mono lowercase tracking-widest"
              pattern="[a-z]{2}"
              maxLength={2}
              required
            />
          </Field>
          <Field label="Alternative languages" hint="Optional, comma-separated">
            <Input
              type="text"
              value={m.alternativeLanguages.join(', ')}
              onChange={(e) => setM({
                ...m,
                alternativeLanguages: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
              })}
              className="font-mono lowercase tracking-widest"
              placeholder="fr, de"
            />
          </Field>
        </div>
      </Section>

      <Section
        icon={<Check className="size-4" />}
        title="Status"
        hint="Disabled markets are skipped during apply runs."
      >
        <button
          type="button"
          onClick={() => setM({ ...m, enabled: !m.enabled })}
          className="flex items-center justify-between w-full text-left rounded-xl border border-input bg-input/20 hover:bg-input/40 transition-colors px-4 py-3"
          aria-pressed={m.enabled}
        >
          <div>
            <div className="font-medium">{m.enabled ? 'Enabled' : 'Disabled'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {m.enabled
                ? 'Included in apply runs across selected stores.'
                : 'Will be skipped by all apply runs.'}
            </div>
          </div>
          <div
            className={
              'relative h-6 w-11 rounded-full transition-colors ' +
              (m.enabled ? 'bg-primary' : 'bg-muted')
            }
          >
            <span
              className={
                'absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ' +
                (m.enabled ? 'translate-x-5' : 'translate-x-0.5')
              }
            />
          </div>
        </button>
      </Section>

      <footer className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3 pt-2 border-t border-border">
        <div className="text-xs text-muted-foreground flex items-center gap-2 h-8">
          {error ? (
            <span className="text-destructive flex items-center gap-1.5">
              <X className="size-3.5" />
              {error}
            </span>
          ) : savedAt ? (
            <span className="text-emerald-600 dark:text-emerald-500 flex items-center gap-1.5">
              <Check className="size-3.5" />
              Saved at {savedAt.toLocaleTimeString()}
            </span>
          ) : (
            <span>Changes apply to the template — re-run apply to push them to stores.</span>
          )}
        </div>
        <Button type="submit" disabled={busy} size="lg" className="md:min-w-44 gap-2">
          <Save className="size-4" />
          {busy ? 'Saving…' : isNew ? 'Create market' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="text-sm font-semibold uppercase tracking-wider">{title}</h3>
        </div>
        {hint && <p className="text-xs text-muted-foreground hidden md:block">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

function TypeOption({
  value,
  current,
  onSelect,
  label,
  hint,
}: {
  value: 'regional' | 'international';
  current: 'regional' | 'international';
  onSelect: (v: 'regional' | 'international') => void;
  label: string;
  hint: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={
        'px-4 py-2 rounded-lg text-sm transition-all text-left ' +
        (active
          ? 'bg-background shadow-sm font-medium'
          : 'text-muted-foreground hover:text-foreground')
      }
    >
      <div>{label}</div>
      <div className="text-xs font-normal opacity-70">{hint}</div>
    </button>
  );
}
