'use client';

import { useState } from 'react';
import {
  TrendingUp, Truck, Plus, Trash2, Save, AlertCircle, Check, X, MapPin,
} from 'lucide-react';
import type {
  Market, MarketStoreOverride, ShippingZone, ShippingRate, MarketShipping, MarketPriceAdjustment,
} from '@/features/markets/types';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { currencyDecimals } from '@/lib/currency-format';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  market: Market;
  storeId: string;
  storeName: string;
  initial: MarketStoreOverride;
  onSubmit: (o: MarketStoreOverride) => Promise<void>;
}

const ISO2_RE = /^[A-Z]{2}$/;

export function OverrideForm({ market, storeId, storeName, initial, onSubmit }: Props) {
  const [adj, setAdj] = useState<MarketPriceAdjustment | null>(initial.priceAdjustment);
  const [shipping, setShipping] = useState<MarketShipping | null>(initial.shipping);
  const [zoneDraft, setZoneDraft] = useState('');
  const [rateDraftByZone, setRateDraftByZone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function addZone() {
    const name = zoneDraft.trim();
    if (!name) return;
    if (shipping?.zones[name]) {
      setError(`Zone "${name}" already exists.`);
      return;
    }
    setShipping({ zones: { ...(shipping?.zones ?? {}), [name]: { countries: [], rates: {} } } });
    setZoneDraft('');
    setError(null);
  }

  function removeZone(name: string) {
    if (!shipping) return;
    const { [name]: _gone, ...rest } = shipping.zones;
    setShipping(Object.keys(rest).length === 0 ? null : { zones: rest });
  }

  function updateZone(name: string, patch: Partial<ShippingZone>) {
    if (!shipping) return;
    setShipping({ zones: { ...shipping.zones, [name]: { ...shipping.zones[name], ...patch } } });
  }

  function addRate(zoneName: string) {
    const name = (rateDraftByZone[zoneName] ?? '').trim();
    if (!name) return;
    if (shipping?.zones[zoneName].rates[name]) {
      setError(`Rate "${name}" already exists in zone "${zoneName}".`);
      return;
    }
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [name]: { type: 'flat', price: 0, currency: market.primaryCurrency },
      },
    });
    setRateDraftByZone({ ...rateDraftByZone, [zoneName]: '' });
    setError(null);
  }

  function removeRate(zoneName: string, rateName: string) {
    if (!shipping) return;
    const { [rateName]: _gone, ...restRates } = shipping.zones[zoneName].rates;
    updateZone(zoneName, { rates: restRates });
  }

  function updateRate(zoneName: string, rateName: string, patch: Partial<ShippingRate>) {
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [rateName]: { ...shipping!.zones[zoneName].rates[rateName], ...patch },
      },
    });
  }

  const adjEnabled = adj !== null;
  const zoneCount = shipping ? Object.keys(shipping.zones).length : 0;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit({ storeId, marketHandle: market.handle, priceAdjustment: adj, shipping });
          setSavedAt(new Date());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-10"
    >
      {/* Context strip */}
      <div className="rounded-xl bg-muted/40 border border-border px-5 py-3.5 text-xs text-muted-foreground flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <span><span className="text-foreground/80 font-medium">Store:</span> {storeName}</span>
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span><span className="text-foreground/80 font-medium">Market:</span> {market.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={adjEnabled ? 'secondary' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider">
            {adjEnabled ? `${adj!.value > 0 ? '+' : ''}${adj!.value}% price` : 'No price adj'}
          </Badge>
          <Badge variant={zoneCount > 0 ? 'secondary' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider">
            {zoneCount} {zoneCount === 1 ? 'zone' : 'zones'}
          </Badge>
        </div>
      </div>

      {/* Price adjustment */}
      <Section
        icon={<TrendingUp className="size-4" />}
        title="Price adjustment"
        hint="Multiply Shopify's base price for this market. Leave off to inherit template behavior."
      >
        <button
          type="button"
          onClick={() => setAdj(adjEnabled ? null : { type: 'percentage', value: 0 })}
          className="flex items-center justify-between w-full text-left rounded-xl border border-input bg-input/20 hover:bg-input/40 transition-colors px-4 py-3 mb-4"
          aria-pressed={adjEnabled}
        >
          <div>
            <div className="font-medium">{adjEnabled ? 'Adjustment enabled' : 'Use template pricing'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {adjEnabled ? 'Storefront prices for this market will be shifted by the value below.' : 'No store-side override — template wins.'}
            </div>
          </div>
          <div className={'relative h-6 w-11 rounded-full transition-colors ' + (adjEnabled ? 'bg-primary' : 'bg-muted')}>
            <span className={'absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ' + (adjEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
          </div>
        </button>

        {adj && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
                Adjustment percentage
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={adj.value}
                  min={-50}
                  max={200}
                  step={0.5}
                  onChange={(e) => setAdj({ type: 'percentage', value: Number(e.target.value) })}
                  className="font-mono tabular-nums w-32"
                />
                <span className="text-sm text-muted-foreground">% (range: −50 to +200)</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Negative discounts the price; positive marks it up.
              </p>
            </div>
            <PreviewSwatch value={adj.value} />
          </div>
        )}
      </Section>

      {/* Shipping zones */}
      <Section
        icon={<Truck className="size-4" />}
        title="Shipping zones"
        hint="Per-store zones replace the template's zones for this market on this store."
      >
        {/* Add zone */}
        <div className="flex items-center gap-2 mb-4">
          <Input
            type="text"
            value={zoneDraft}
            onChange={(e) => setZoneDraft(e.target.value)}
            placeholder="New zone name (e.g. Domestic)"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addZone();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addZone} className="gap-1.5">
            <Plus className="size-4" />
            Add zone
          </Button>
        </div>

        {!shipping || zoneCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <div className="text-sm font-medium">No per-store zones</div>
            <div className="text-xs text-muted-foreground mt-1">This store will use whatever shipping the template defines.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(shipping.zones).map(([zoneName, zone]) => (
              <ZoneCard
                key={zoneName}
                name={zoneName}
                zone={zone}
                marketCountries={market.countries}
                marketPrimaryCurrency={market.primaryCurrency}
                rateDraft={rateDraftByZone[zoneName] ?? ''}
                onRateDraftChange={(v) => setRateDraftByZone({ ...rateDraftByZone, [zoneName]: v })}
                onAddRate={() => addRate(zoneName)}
                onRemoveRate={(rateName) => removeRate(zoneName, rateName)}
                onUpdateRate={(rateName, patch) => updateRate(zoneName, rateName, patch)}
                onCountriesChange={(countries) => updateZone(zoneName, { countries })}
                onRemoveZone={() => removeZone(zoneName)}
              />
            ))}
          </div>
        )}
      </Section>

      <footer className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3 pt-2 border-t border-border">
        <div className="text-xs h-8 flex items-center gap-2">
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
            <span className="text-muted-foreground">
              Override is saved per store. Re-run apply to push it to Shopify.
            </span>
          )}
        </div>
        <Button type="submit" disabled={busy} size="lg" className="md:min-w-44 gap-2">
          <Save className="size-4" />
          {busy ? 'Saving…' : 'Save override'}
        </Button>
      </footer>
    </form>
  );
}

interface ZoneCardProps {
  name: string;
  zone: ShippingZone;
  marketCountries: string[];
  marketPrimaryCurrency: string;
  rateDraft: string;
  onRateDraftChange: (v: string) => void;
  onAddRate: () => void;
  onRemoveRate: (rateName: string) => void;
  onUpdateRate: (rateName: string, patch: Partial<ShippingRate>) => void;
  onCountriesChange: (countries: string[]) => void;
  onRemoveZone: () => void;
}

function ZoneCard({
  name, zone, marketCountries, marketPrimaryCurrency,
  rateDraft, onRateDraftChange, onAddRate, onRemoveRate, onUpdateRate,
  onCountriesChange, onRemoveZone,
}: ZoneCardProps) {
  const validCountries = zone.countries.filter((c) => ISO2_RE.test(c));
  const invalidCount = zone.countries.length - validCountries.length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="size-4 text-muted-foreground shrink-0" />
          <h4 className="font-medium truncate">{name}</h4>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemoveZone}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Remove zone</span>
        </Button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Countries
          </Label>
          <Input
            type="text"
            value={zone.countries.join(', ')}
            onChange={(e) => onCountriesChange(
              e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
            )}
            placeholder={marketCountries.join(', ') || 'DE, FR, IT'}
            className="font-mono"
          />
          {validCountries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {validCountries.map((c) => (
                <Badge key={c} variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">{c}</Badge>
              ))}
            </div>
          )}
          {invalidCount > 0 && (
            <p className="text-xs text-destructive mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="size-3" />
              {invalidCount} entry not a valid ISO-2 code
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
            Rates
          </Label>
          {Object.keys(zone.rates).length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No rates yet — add one below.</p>
          ) : (
            <div className="space-y-2 mb-3">
              {Object.entries(zone.rates).map(([rateName, rate]) => (
                <div key={rateName} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                  <span className="text-sm font-medium truncate" title={rateName}>{rateName}</span>
                  <MoneyInput
                    value={String(rate.price ?? '')}
                    onValueChange={(raw) => onUpdateRate(rateName, { price: raw === '' ? 0 : Number(raw) })}
                    decimals={currencyDecimals(rate.currency)}
                    className="w-28"
                    inputClassName="text-right"
                  />
                  <Input
                    type="text"
                    value={rate.currency}
                    onChange={(e) => onUpdateRate(rateName, { currency: e.target.value.toUpperCase() })}
                    className="w-20 font-mono uppercase tracking-widest"
                    maxLength={3}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveRate(rateName)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                    aria-label={`Remove ${rateName}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={rateDraft}
              onChange={(e) => onRateDraftChange(e.target.value)}
              placeholder={`New rate name (defaults to ${marketPrimaryCurrency} 0.00)`}
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAddRate();
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={onAddRate} className="gap-1.5">
              <Plus className="size-3.5" />
              Add rate
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSwatch({ value }: { value: number }) {
  const sign = value > 0 ? '+' : '';
  const colorClass = value > 0
    ? 'text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
    : value < 0
      ? 'text-rose-600 dark:text-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60'
      : 'text-muted-foreground bg-muted/40 border-border';
  return (
    <div className={'rounded-xl border px-4 py-2.5 text-center min-w-32 ' + colorClass}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">Effect</div>
      <div className="text-2xl font-semibold tabular-nums">{sign}{value}%</div>
    </div>
  );
}

function Section({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
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
