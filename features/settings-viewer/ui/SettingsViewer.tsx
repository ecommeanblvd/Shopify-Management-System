import {
  Truck, Globe2, MapPin, AlertCircle, CheckCircle2, Wrench, Code,
  PackageOpen, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  normalizeShipping, isShippingError, formatMoney, rateTypeLabel,
  type NormalizedShipping, type NormalizedZone, type NormalizedRate, type ShippingError,
} from './normalize';

interface StoreSettings {
  storeName: string;
  shipping: unknown;
  checkoutStatus: 'available' | 'needs_migration';
}

export function SettingsViewer({ stores }: { stores: StoreSettings[] }) {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-2">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Settings Viewer</h1>
        <p className="text-sm text-muted-foreground">
          Read-only snapshot of shipping and checkout configuration for each connected store.
        </p>
      </header>

      {stores.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {stores.map((s) => <StoreCard key={s.storeName} store={s} />)}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <PackageOpen className="size-10 mx-auto text-muted-foreground mb-3" />
        <div className="font-medium">No stores connected yet</div>
        <div className="text-sm text-muted-foreground mt-1">
          Connect a Shopify store on the Stores page to inspect its settings here.
        </div>
      </CardContent>
    </Card>
  );
}

function StoreCard({ store }: { store: StoreSettings }) {
  const checkoutReady = store.checkoutStatus === 'available';
  const isError = isShippingError(store.shipping);
  const norm = isError ? null : normalizeShipping(store.shipping);

  return (
    <Card>
      <CardContent className="p-6 md:p-10 space-y-8">
        {/* Hero */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{store.storeName}</h2>
            {norm && (
              <div className="text-xs text-muted-foreground font-mono">
                {norm.totals.profiles} {norm.totals.profiles === 1 ? 'profile' : 'profiles'} ·{' '}
                {norm.totals.zones} {norm.totals.zones === 1 ? 'zone' : 'zones'} ·{' '}
                {norm.totals.rates} {norm.totals.rates === 1 ? 'rate' : 'rates'} ·{' '}
                {norm.totals.countries} {norm.totals.countries === 1 ? 'country' : 'countries'}
              </div>
            )}
          </div>
          <CheckoutBadge ready={checkoutReady} />
        </div>

        <Tabs defaultValue="shipping">
          <TabsList>
            <TabsTrigger value="shipping" className="gap-1.5">
              <Truck className="size-3.5" />
              Shipping
            </TabsTrigger>
            <TabsTrigger value="checkout" className="gap-1.5">
              <Wrench className="size-3.5" />
              Checkout branding
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shipping" className="mt-6">
            {isError ? (
              <ErrorPanel data={store.shipping as ShippingError} />
            ) : norm && norm.profiles.length > 0 ? (
              <ShippingPanel data={norm} />
            ) : (
              <InfoPanel
                tone="muted"
                title="No delivery profiles found"
                body="This store hasn't configured shipping zones yet."
              />
            )}
            <RawJsonDisclosure value={store.shipping} />
          </TabsContent>

          <TabsContent value="checkout" className="mt-6">
            {checkoutReady ? (
              <InfoPanel
                tone="success"
                title="Checkout branding available"
                body="This store is on Checkout Extensibility — branding can be read and synced from the admin."
              />
            ) : (
              <InfoPanel
                tone="warning"
                title="Checkout Extensibility migration pending"
                body="Branding can't be read until you upgrade this store's checkout. Open Shopify admin → Settings → Checkout → Upgrade."
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CheckoutBadge({ ready }: { ready: boolean }) {
  if (ready) {
    return (
      <Badge variant="default" className="h-6 gap-1.5">
        <CheckCircle2 className="size-3" />
        Checkout ready
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-6 gap-1.5 text-amber-600 dark:text-amber-500 border-amber-200 dark:border-amber-900">
      <AlertCircle className="size-3" />
      Checkout needs migration
    </Badge>
  );
}

function ShippingPanel({ data }: { data: NormalizedShipping }) {
  return (
    <div className="space-y-6">
      {data.profiles.map((profile, i) => (
        <div key={`${profile.name}-${i}`} className="space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Truck className="size-3.5" />
            <span className="font-semibold">{profile.name}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{profile.zones.length} {profile.zones.length === 1 ? 'zone' : 'zones'}</span>
          </div>
          {profile.zones.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-4">No zones configured</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {profile.zones.map((zone) => <ZoneCard key={zone.name} zone={zone} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ZoneCard({ zone }: { zone: NormalizedZone }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/40 border-b border-border">
        <div className="flex items-center gap-2">
          {zone.restOfWorld ? <Globe2 className="size-4 text-muted-foreground" /> : <MapPin className="size-4 text-muted-foreground" />}
          <span className="font-medium text-sm">{zone.name}</span>
        </div>
        {zone.countries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {zone.countries.slice(0, 12).map((c) => (
              <Badge key={c} variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">{c}</Badge>
            ))}
            {zone.countries.length > 12 && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">+{zone.countries.length - 12}</Badge>
            )}
          </div>
        )}
        {zone.restOfWorld && zone.countries.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">Catches every country not in another zone.</p>
        )}
      </div>
      {zone.rates.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground italic">No rates configured</div>
      ) : (
        <ul className="divide-y divide-border">
          {zone.rates.map((rate, idx) => <RateRow key={`${rate.name}-${idx}`} rate={rate} />)}
        </ul>
      )}
    </div>
  );
}

function RateRow({ rate }: { rate: NormalizedRate }) {
  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{rate.name}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{rateTypeLabel(rate.type)}</div>
      </div>
      <div className="text-sm font-mono tabular-nums">
        {rate.price
          ? formatMoney(rate.price.amount, rate.price.currency)
          : <span className="text-muted-foreground italic">calc&apos;d</span>}
      </div>
    </li>
  );
}

function InfoPanel({ tone, title, body }: { tone: 'success' | 'warning' | 'muted'; title: string; body: string }) {
  const toneClass = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-100',
    warning: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-100',
    muted: 'bg-muted/40 border-border text-foreground',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertCircle : ChevronRight;
  return (
    <div className={`rounded-xl border p-5 flex items-start gap-3 ${toneClass}`}>
      <Icon className="size-5 shrink-0 mt-0.5" />
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="text-sm opacity-80 mt-1">{body}</div>
      </div>
    </div>
  );
}

function ErrorPanel({ data }: { data: ShippingError }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-sm">{data.error}</div>
          {data.detail && (
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{data.detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RawJsonDisclosure({ value }: { value: unknown }) {
  return (
    <details className="mt-6 group">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 list-none">
        <Code className="size-3.5 transition-transform group-open:rotate-90" />
        Raw JSON
      </summary>
      <pre className="text-xs font-mono p-4 mt-3 rounded-lg bg-muted/40 border border-border overflow-auto max-h-96">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
