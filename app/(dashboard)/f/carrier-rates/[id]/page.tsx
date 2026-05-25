import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ChevronLeft, Truck, Globe2, Coins, Layers, Wrench, MapPin, Calculator, Send, AlertCircle, Trash2, ArrowRight,
} from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount, updateAccount, deleteAccount } from '@/features/carrier-rates/actions';
import { daysSince } from '@/features/carrier-rates/lib';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const FX_STALE_DAYS = 30;

async function toggleEnabledAction(id: string, next: boolean, userId: string) {
  'use server';
  await updateAccount({ id, enabled: next }, userId);
  revalidatePath(`/f/carrier-rates/${id}`);
  revalidatePath('/f/carrier-rates');
}

async function deleteAction(id: string) {
  'use server';
  await deleteAccount(id);
  redirect('/f/carrier-rates');
}

export default async function CarrierAccountDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
      </div>
    );
  }

  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const fxNumber = Number(account.fxCostPerDisplay);
  const fxFormatted = Number.isFinite(fxNumber) ? fxNumber.toLocaleString() : account.fxCostPerDisplay;
  const fxAge = daysSince(account.fxUpdatedAt);
  const fxStale = fxAge >= FX_STALE_DAYS;

  const toggleBound = toggleEnabledAction.bind(null, id, !account.enabled, session.user.id);
  const deleteBound = deleteAction.bind(null, id);

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/carrier-rates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Carrier rates
      </Link>

      <header className="space-y-3">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2 min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Truck className="size-3.5" />
              {account.carrierName ?? account.carrierKey ?? 'Unknown carrier'}
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{account.name}</h1>
            {account.notes && <p className="text-sm text-muted-foreground max-w-xl">{account.notes}</p>}
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <form action={toggleBound}>
                <Button type="submit" variant="outline">
                  {account.enabled ? 'Disable' : 'Enable'}
                </Button>
              </form>
              <form action={deleteBound}>
                <Button type="submit" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2">
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </form>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={account.enabled ? 'default' : 'outline'} className="h-6 text-[10px] uppercase tracking-wider">
            {account.enabled ? 'Active' : 'Disabled'}
          </Badge>
          <Badge variant="secondary" className="h-6 text-[10px] uppercase tracking-wider font-mono">
            {account.costCurrency} → {account.displayCurrency}
          </Badge>
          <Badge variant="secondary" className="h-6 text-[10px] uppercase tracking-wider">
            Weights in {account.weightUnit}
          </Badge>
        </div>
      </header>

      {fxStale && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-5 py-3.5 flex items-start gap-3 text-sm">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">FX rate is {fxAge} days old</div>
            <p className="opacity-80 mt-1">
              The current rate ({fxFormatted} {account.costCurrency} per 1 {account.displayCurrency}) has not been refreshed in over {FX_STALE_DAYS} days. Update it before pushing rates to stores.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="FX rate" value={fxFormatted} sub={`${account.costCurrency} per 1 ${account.displayCurrency}`} tone={fxStale ? 'warning' : 'default'} />
        <StatTile label="Updated" value={`${fxAge}d ago`} sub={new Date(account.fxUpdatedAt).toLocaleDateString()} />
        <StatTile label="Weight unit" value={account.weightUnit} sub="Cost sheet basis" />
        <StatTile label="Phase" value="2a" sub="Authoring live" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SubSection
          href={`/f/carrier-rates/${id}/zones`}
          icon={<Globe2 className="size-4" />}
          title="Zones"
          desc="Group countries into the carrier's zones (Zone 1, Zone A, …)."
          status="Ready"
        />
        <SubSection
          href={`/f/carrier-rates/${id}/weight-tiers`}
          icon={<Layers className="size-4" />}
          title="Weight tiers"
          desc="Breakpoints for the rate matrix rows."
          status="Ready"
        />
        <SubSection
          href={`/f/carrier-rates/${id}/matrix`}
          icon={<Coins className="size-4" />}
          title="Rate matrix"
          desc="Cost per (zone × tier). Inline edit + CSV import."
          status="Ready"
          accent
        />
        <SubSection
          href={`/f/carrier-rates/${id}/surcharges`}
          icon={<Wrench className="size-4" />}
          title="Surcharges"
          desc="Fuel %, peak fixed, remote fixed, residential fixed, per-kg green, markup %."
          status="Ready"
        />
        <SubSection
          href={`/f/carrier-rates/${id}/remote-postcodes`}
          icon={<MapPin className="size-4" />}
          title="Remote postcodes"
          desc="CSV upload of DHL/FedEx remote-area postal codes by country."
          status="Ready"
        />
        <SubSection
          href={`/f/carrier-rates/${id}/calculator`}
          icon={<Calculator className="size-4" />}
          title="Calculator"
          desc="Try a quote: country + postcode + weight → breakdown."
          status="Ready"
        />
        <SubSection
          href={`/f/carrier-rates/${id}/push`}
          icon={<Send className="size-4" />}
          title="Recalculate &amp; push"
          desc="Regenerate per-store overrides for every linked market."
          status="Ready"
        />
      </div>
    </div>
  );
}

function StatTile({
  label, value, sub, tone = 'default',
}: { label: string; value: string; sub: string; tone?: 'default' | 'warning' }) {
  const c = tone === 'warning' ? 'text-amber-600 dark:text-amber-500' : '';
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular-nums truncate ${c}`}>{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function SubSection({
  href, icon, title, desc, status, accent = false,
}: { href?: string; icon: React.ReactNode; title: string; desc: string; status: string; accent?: boolean }) {
  const body = (
    <CardContent className={'p-5 flex items-start gap-4 ' + (accent ? 'bg-primary/[0.03]' : '')}>
      <div className={'size-10 rounded-xl flex items-center justify-center shrink-0 ' + (accent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <Badge variant={status === 'Ready' ? 'secondary' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider shrink-0">{status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className={'size-4 shrink-0 transition-transform ' + (href ? 'text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground' : 'text-muted-foreground/30')} />
    </CardContent>
  );

  if (href) {
    return (
      <Link href={href} className="group block">
        <Card className="hover:border-foreground/30 transition-colors">{body}</Card>
      </Link>
    );
  }
  return <Card className="opacity-70">{body}</Card>;
}
