import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Plus, Truck, Globe2, Coins, ArrowRight, AlertCircle, Sparkles, Scale, MapPin } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listAccounts, listCarriers } from '@/features/carrier-rates/actions';
import { daysSince } from '@/features/carrier-rates/lib';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const FX_STALE_DAYS = 30;

export default async function CarrierRatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to view carrier rates.</p>
      </div>
    );
  }

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const [accounts, carriers] = await Promise.all([listAccounts(), listCarriers()]);
  const enabledCount = accounts.filter((a) => a.enabled).length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2 min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Truck className="size-3.5" />
              Feature
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Carrier rates</h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Author DHL and FedEx rate sheets once. Quote calculator surfaces the final customer-facing price; the push step writes per-store overrides for the Markets apply flow.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/f/carrier-rates/geo-lookup" className={buttonVariants({ variant: 'outline' }) + ' gap-1.5 px-4 h-9'}>
              <MapPin className="size-4" />
              Tra cứu geo
            </Link>
            <Link href="/f/carrier-rates/compare" className={buttonVariants({ variant: 'outline' }) + ' gap-1.5 px-4 h-9'}>
              <Scale className="size-4" />
              So sánh cước
            </Link>
            {canManage && (
              <Link href="/f/carrier-rates/new" className={buttonVariants() + ' gap-1.5 px-4 h-9'}>
                <Plus className="size-4" />
                New account
              </Link>
            )}
          </div>
        </div>
      </header>

      {accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <StatTile label="Accounts" value={String(accounts.length)} sub={enabledCount === accounts.length ? 'All enabled' : `${enabledCount} enabled`} />
          <StatTile label="Carriers" value={String(carriers.length)} sub={carriers.map((c) => c.name).join(' + ')} />
          <StatTile
            label="Currency pairs"
            value={String(new Set(accounts.map((a) => `${a.costCurrency}/${a.displayCurrency}`)).size)}
            sub="Cost → display"
          />
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState canManage={canManage} carriersExist={carriers.length > 0} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((a) => <AccountCard key={a.id} account={a} />)}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

interface AccountSummary {
  id: string;
  name: string;
  weightUnit: 'kg' | 'lb';
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: string;
  fxUpdatedAt: Date;
  enabled: boolean;
  notes: string | null;
  carrierKey: string | null;
  carrierName: string | null;
}

function AccountCard({ account }: { account: AccountSummary }) {
  const fxNumber = Number(account.fxCostPerDisplay);
  const fxFormatted = Number.isFinite(fxNumber) ? fxNumber.toLocaleString() : account.fxCostPerDisplay;
  const fxAge = daysSince(account.fxUpdatedAt);
  const fxStale = fxAge >= FX_STALE_DAYS;

  return (
    <Link
      href={`/f/carrier-rates/${account.id}`}
      className="group rounded-2xl border border-border bg-card hover:border-foreground/30 hover:bg-card/80 transition-all overflow-hidden flex flex-col"
    >
      <div className="p-5 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{account.carrierKey ?? '—'}</div>
            <h2 className="font-semibold tracking-tight text-base truncate mt-0.5">{account.name}</h2>
          </div>
          <Badge
            variant={account.enabled ? 'default' : 'outline'}
            className="h-5 px-2 text-[10px] uppercase tracking-wider shrink-0"
          >
            {account.enabled ? 'Active' : 'Off'}
          </Badge>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          {account.notes && <p className="line-clamp-2">{account.notes}</p>}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-mono">
            <Coins className="size-3" />
            {account.costCurrency} → {account.displayCurrency}
          </span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            1 {account.displayCurrency} = {fxFormatted} {account.costCurrency}
          </span>
          {fxStale && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
              <AlertCircle className="size-3" />
              FX {fxAge}d old
            </span>
          )}
        </div>
        <ArrowRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground transition-all" />
      </div>
    </Link>
  );
}

function EmptyState({ canManage, carriersExist }: { canManage: boolean; carriersExist: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 md:p-16 text-center bg-muted/20">
      <div className="size-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-4">
        <Sparkles className="size-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight mb-2">No carrier accounts yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
        Create one carrier account per contract. Each holds its own zone scheme, weight tiers, rate matrix, and surcharges.
      </p>
      {canManage && (
        <Link href="/f/carrier-rates/new" className={buttonVariants({ size: 'lg' }) + ' gap-2 px-5'}>
          <Plus className="size-4" />
          {carriersExist ? 'Create first account' : 'Get started'}
        </Link>
      )}
      {!canManage && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Globe2 className="size-3" />
          Ask an admin to create an account.
        </p>
      )}
    </div>
  );
}
