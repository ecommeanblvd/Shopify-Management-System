import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Plus, Sparkles, PlayCircle, Globe2, ArrowRight, MapPin, Coins, Languages } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listTemplates, seedDefaultMarkets } from '@/features/markets/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Market } from '@/features/markets/types';

export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const markets = await listTemplates();
  const canManage = hasPermission(role, 'manage_markets_template');
  const enabledCount = markets.filter((m) => m.enabled).length;
  const regionalCount = markets.filter((m) => m.type === 'regional').length;
  const totalCountries = markets.reduce((sum, m) => sum + m.countries.length, 0);

  async function handleSeed() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await seedDefaultMarkets(s.user.id);
    revalidatePath('/f/markets');
  }

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      {/* Hero */}
      <header className="space-y-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2 min-w-0">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Markets</h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Region templates that drive Shopify Markets across every connected store. Edit a template once — Apply pushes it everywhere.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canManage && (
              <Link href="/f/markets/new" className={buttonVariants() + ' gap-1.5 px-4 h-9'}>
                <Plus className="size-4" />
                New market
              </Link>
            )}
            <Link href="/f/markets/apply" className={buttonVariants({ variant: 'outline' }) + ' gap-1.5 px-4 h-9'}>
              <PlayCircle className="size-4" />
              Apply to stores…
            </Link>
          </div>
        </div>

        {markets.length > 0 && (
          <div className="flex items-center gap-6 text-xs text-muted-foreground border-t border-border pt-4">
            <Stat label="Templates" value={String(markets.length)} />
            <Stat label="Enabled" value={`${enabledCount}/${markets.length}`} />
            <Stat label="Regional" value={String(regionalCount)} />
            <Stat label="Countries covered" value={String(totalCountries)} />
          </div>
        )}
      </header>

      {markets.length === 0 ? (
        <EmptyState canManage={canManage} onSeed={handleSeed} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((m) => <MarketCard key={m.handle} m={m} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-base font-semibold text-foreground tabular-nums">{value}</span>
      <span className="uppercase tracking-wider">{label}</span>
    </div>
  );
}

function MarketCard({ m }: { m: Market }) {
  const isInternational = m.type === 'international';
  const previewCountries = m.countries.slice(0, 6);
  const remaining = m.countries.length - previewCountries.length;

  return (
    <Link
      href={`/f/markets/${m.handle}`}
      className="group relative rounded-2xl border border-border bg-card hover:border-foreground/30 hover:bg-card/80 transition-all overflow-hidden flex flex-col"
    >
      {/* subtle decoration for international */}
      {isInternational && (
        <div className="absolute -top-8 -right-8 size-32 rounded-full bg-primary/5 pointer-events-none" aria-hidden />
      )}

      <div className="p-5 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold tracking-tight text-base truncate">{m.name}</h2>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{m.handle}</p>
          </div>
          <Badge
            variant={m.enabled ? 'default' : 'outline'}
            className="h-5 px-2 text-[10px] uppercase tracking-wider shrink-0"
          >
            {m.enabled ? 'Live' : 'Off'}
          </Badge>
        </div>

        {/* Country preview / international glyph */}
        {isInternational ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Globe2 className="size-4 text-primary" />
            <span>Catch-all for everywhere else</span>
          </div>
        ) : previewCountries.length > 0 ? (
          <div className="flex flex-wrap gap-1 py-1">
            {previewCountries.map((c) => (
              <span key={c} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 tracking-wider">
                {c}
              </span>
            ))}
            {remaining > 0 && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                +{remaining}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic py-2">No countries set</div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" />
            {m.countries.length}
          </span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Coins className="size-3" />
            {m.primaryCurrency}
            {m.alternativeCurrencies.length > 0 && <span className="text-muted-foreground/60">+{m.alternativeCurrencies.length}</span>}
          </span>
          <span className="inline-flex items-center gap-1 font-mono uppercase">
            <Languages className="size-3" />
            {m.primaryLanguage}
            {m.alternativeLanguages.length > 0 && <span className="text-muted-foreground/60">+{m.alternativeLanguages.length}</span>}
          </span>
        </div>
        <ArrowRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground transition-all" />
      </div>
    </Link>
  );
}

function EmptyState({ canManage, onSeed }: { canManage: boolean; onSeed: () => Promise<void> }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 md:p-16 text-center bg-muted/20">
      <div className="size-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-4">
        <Sparkles className="size-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight mb-2">No markets configured</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
        Markets group countries, currencies, and languages into a single storefront experience. Seed the 11 ECC defaults to get started, or create a custom one.
      </p>
      {canManage && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <form action={onSeed}>
            <Button type="submit" size="lg" className="gap-2">
              <Sparkles className="size-4" />
              Seed default markets
            </Button>
          </form>
          <Link href="/f/markets/new" className={buttonVariants({ variant: 'outline', size: 'lg' }) + ' gap-2 px-5'}>
            <Plus className="size-4" />
            Create from scratch
          </Link>
        </div>
      )}
    </div>
  );
}
