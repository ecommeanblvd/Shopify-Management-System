'use client';

import { useState, useTransition } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import type { WishlistConfig } from '@/features/functions/wishlist/config';

interface ResolvedWishlistConfig {
  accentColor: string;
  buttonLabel: { unsaved: string; saved: string };
  buttonPosition: 'append' | 'prepend';
  emailCapture: { enabled: boolean; headline: string; cta: string };
}

interface WishlistSettingsFormProps {
  storeId: string;
  initial: ResolvedWishlistConfig;
  canManage: boolean;
  saveAction: (storeId: string, input: WishlistConfig) => Promise<void>;
}

/** Per-store wishlist settings: accent color, button labels & position,
 *  email-capture copy. Mirrors the WishlistConfig zod schema so server
 *  validation rejects the same things this form does. */
export function WishlistSettingsForm({
  storeId, initial, canManage, saveAction,
}: WishlistSettingsFormProps) {
  const [draft, setDraft] = useState<ResolvedWishlistConfig>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const reset = (): void => setDraft(initial);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await saveAction(storeId, draft);
        setSavedAt(Date.now());
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Accent color" hint="Used for the saved-state button and count badge">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.accentColor}
              onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
              disabled={!canManage || pending}
              className="size-8 rounded-md border border-border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Accent color picker"
            />
            <input
              type="text"
              value={draft.accentColor}
              onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
              disabled={!canManage || pending}
              placeholder="#e11d48"
              className="flex-1 font-mono text-xs px-3 py-2 rounded-md border border-border bg-transparent disabled:opacity-50"
            />
          </div>
        </Field>
        <Field label="PDP button position" hint="Where the heart sits in the product form">
          <select
            value={draft.buttonPosition}
            onChange={(e) => setDraft({ ...draft, buttonPosition: e.target.value as 'append' | 'prepend' })}
            disabled={!canManage || pending}
            className="w-full text-sm px-3 py-2 rounded-md border border-border bg-transparent disabled:opacity-50"
          >
            <option value="append">After the buy box (default)</option>
            <option value="prepend">Above the buy box</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Button label — not saved" hint="What the button says before clicking">
          <Text
            value={draft.buttonLabel.unsaved}
            onChange={(v) => setDraft({ ...draft, buttonLabel: { ...draft.buttonLabel, unsaved: v } })}
            disabled={!canManage || pending}
            maxLength={40}
          />
        </Field>
        <Field label="Button label — saved" hint="What the button says after the shopper saves">
          <Text
            value={draft.buttonLabel.saved}
            onChange={(v) => setDraft({ ...draft, buttonLabel: { ...draft.buttonLabel, saved: v } })}
            disabled={!canManage || pending}
            maxLength={40}
          />
        </Field>
      </div>

      <div className="pt-3 border-t border-border space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.emailCapture.enabled}
            onChange={(e) => setDraft({
              ...draft, emailCapture: { ...draft.emailCapture, enabled: e.target.checked },
            })}
            disabled={!canManage || pending}
            className="size-4 rounded border-border"
          />
          <span className="font-medium">Show email-capture banner</span>
          <span className="text-xs text-muted-foreground">— prompts guests to save their list to email after the first item</span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
          <Field label="Headline">
            <Text
              value={draft.emailCapture.headline}
              onChange={(v) => setDraft({
                ...draft, emailCapture: { ...draft.emailCapture, headline: v },
              })}
              disabled={!canManage || pending || !draft.emailCapture.enabled}
              maxLength={80}
            />
          </Field>
          <Field label="CTA button">
            <Text
              value={draft.emailCapture.cta}
              onChange={(v) => setDraft({
                ...draft, emailCapture: { ...draft.emailCapture, cta: v },
              })}
              disabled={!canManage || pending || !draft.emailCapture.enabled}
              maxLength={40}
            />
          </Field>
        </div>
      </div>

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!canManage || pending}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-md bg-foreground text-background disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          <Save className="size-3.5" />
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!canManage || pending}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
        {savedAt && !pending && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved.</span>
        )}
        {!canManage && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            Read-only — needs <code className="font-mono">manage_functions</code>
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Text({
  value, onChange, disabled, maxLength,
}: {
  value: string; onChange: (v: string) => void;
  disabled?: boolean; maxLength?: number;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      maxLength={maxLength}
      className="w-full text-sm px-3 py-2 rounded-md border border-border bg-transparent disabled:opacity-50"
    />
  );
}
