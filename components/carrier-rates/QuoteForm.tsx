'use client';

import { useState, useTransition } from 'react';
import { Calculator, AlertCircle, CheckCircle2, Globe2, Package, Home as HomeIcon, MapPin, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { QuoteResult } from '@/features/carrier-rates/engine/quote';

interface RunQuoteInput {
  weightKg: number;
  destinationCountry: string;
  destinationPostcode?: string;
  isResidential?: boolean;
}

interface Props {
  costCurrency: string;
  displayCurrency: string;
  countryOptions: { code: string; name: string }[];
  runQuoteAction: (input: RunQuoteInput) => Promise<QuoteResult>;
}

const VND_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatCost(n: number, currency: string): string {
  return `${VND_FMT.format(Math.round(n))} ${currency}`;
}

function formatDisplay(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function QuoteForm({ costCurrency, displayCurrency, countryOptions, runQuoteAction }: Props) {
  const [country, setCountry] = useState(countryOptions[0]?.code ?? '');
  const [weight, setWeight] = useState('1');
  const [postcode, setPostcode] = useState('');
  const [residential, setResidential] = useState(false);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) {
      setResult({ ok: false, code: 'invalid_weight', message: 'Enter a positive weight.' });
      return;
    }
    startTransition(async () => {
      const r = await runQuoteAction({
        weightKg: w,
        destinationCountry: country,
        destinationPostcode: postcode.trim() || undefined,
        isResidential: residential,
      });
      setResult(r);
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <Field icon={<Globe2 className="size-4" />} label="Destination country">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full border border-input bg-input/30 rounded-lg px-3 h-10 text-sm"
            required
          >
            {countryOptions.length === 0 ? (
              <option value="">No countries assigned to any zone</option>
            ) : (
              countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))
            )}
          </select>
        </Field>

        <Field icon={<Package className="size-4" />} label="Weight (kg)" hint="Chargeable weight = max(actual, volumetric).">
          <Input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            min="0.001"
            step="0.001"
            required
            className="font-mono tabular-nums"
          />
        </Field>

        <Field icon={<MapPin className="size-4" />} label="Postcode" hint="Optional. Triggers the remote-area surcharge when matched.">
          <Input
            type="text"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            placeholder="e.g. 710000"
            className="font-mono"
          />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={residential}
            onChange={(e) => setResidential(e.target.checked)}
            className="size-4 accent-primary mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HomeIcon className="size-3.5" />
              Residential delivery
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Adds the residential-fixed surcharge if any are active.
            </div>
          </div>
        </label>

        <Button type="submit" size="lg" className="w-full gap-2" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
          {pending ? 'Calculating…' : 'Calculate quote'}
        </Button>
      </form>

      <div className="space-y-4">
        {result === null && (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            Fill the form and hit calculate to see the breakdown here.
          </div>
        )}

        {result?.ok === false && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">{result.code.replace(/_/g, ' ')}</div>
              <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
            </div>
          </div>
        )}

        {result?.ok === true && (
          <ResultPanel result={result} costCurrency={costCurrency} displayCurrency={displayCurrency} />
        )}
      </div>
    </div>
  );
}

function Field({
  icon, label, hint, children,
}: { icon: React.ReactNode; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ResultPanel({ result, costCurrency, displayCurrency }: { result: Extract<QuoteResult, { ok: true }>; costCurrency: string; displayCurrency: string }) {
  const { breakdown, zone, tier, notes } = result;
  const rows: { label: string; value: number; muted?: boolean }[] = [
    { label: 'Base rate', value: breakdown.base },
    { label: 'Fuel', value: breakdown.fuel, muted: breakdown.fuel === 0 },
    { label: 'Peak / premium', value: breakdown.peak, muted: breakdown.peak === 0 },
    { label: 'Per-kg fixed', value: breakdown.perKg, muted: breakdown.perKg === 0 },
    { label: 'Remote area', value: breakdown.remote, muted: breakdown.remote === 0 },
    { label: 'Residential', value: breakdown.residential, muted: breakdown.residential === 0 },
    {
      // Negotiated FedEx Total Discount — engine emits as a positive
      // `discount`, render with a minus prefix so it reads as a deduction.
      label: breakdown.discountPercent > 0
        ? `Volume discount (${breakdown.discountPercent.toFixed(1)}%)`
        : 'Volume discount',
      value: -breakdown.discount,
      muted: breakdown.discount === 0,
    },
  ];

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-5" />
          <h3 className="font-semibold">Quote</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="h-5 text-[10px] uppercase tracking-wider">{zone}</Badge>
          <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider font-mono">
            tier ≤ {tier.upperKg} kg
          </Badge>
        </div>
      </div>

      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.label} className={`flex items-center justify-between ${r.muted ? 'text-muted-foreground/60' : ''}`}>
            <span>{r.label}</span>
            <span className="font-mono tabular-nums">{formatCost(r.value, costCurrency)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between pt-2 mt-2 border-t border-emerald-300/40 dark:border-emerald-800/40 text-sm">
          <span className="font-medium">Subtotal before markup</span>
          <span className="font-mono tabular-nums">{formatCost(breakdown.subtotalBeforeMarkup, costCurrency)}</span>
        </li>
        <li className={`flex items-center justify-between ${breakdown.markup === 0 ? 'text-muted-foreground/60' : ''}`}>
          <span>Markup</span>
          <span className="font-mono tabular-nums">{formatCost(breakdown.markup, costCurrency)}</span>
        </li>
      </ul>

      <div className="rounded-xl bg-emerald-100/60 dark:bg-emerald-900/30 px-5 py-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer-facing rate</div>
          <div className="text-3xl font-semibold tabular-nums mt-0.5">
            {formatDisplay(breakdown.finalDisplay, displayCurrency)}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>cost</div>
          <div className="font-mono tabular-nums text-foreground/70">
            {formatCost(breakdown.finalCost, costCurrency)}
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <div>{notes.join(' · ')}</div>
        </div>
      )}
    </div>
  );
}
