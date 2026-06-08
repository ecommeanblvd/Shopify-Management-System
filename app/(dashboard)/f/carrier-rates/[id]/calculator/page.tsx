import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, Calculator } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot, runQuote } from '@/features/carrier-rates/engine/load';
import { Card, CardContent } from '@/components/ui/card';
import { QuoteForm } from '@/components/carrier-rates/QuoteForm';

export const dynamic = 'force-dynamic';

const ISO2_RE = /^[A-Z]{2}$/;
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string): string {
  if (!ISO2_RE.test(code)) return code;
  try { return REGION_NAMES.of(code) ?? code; } catch { return code; }
}

export default async function CalculatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const snap = await loadAccountSnapshot(id);
  const countryOptions = snap
    ? Array.from(snap.zonesByCountry.keys())
        .map((code) => ({ code, name: countryName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const userId = session.user.id;
  async function runQuoteAction(input: { weightKg: number; destinationCountry: string; destinationPostcode?: string; isResidential?: boolean }) {
    'use server';
    const result = await runQuote(id, input, userId);
    // Strip the snapshotLoaded helper before returning — client only needs QuoteResult
    const { snapshotLoaded: _ignored, ...rest } = result;
    void _ignored;
    return rest;
  }

  const totalZones = snap?.zonesByCountry.size ?? 0;
  const surcharges = snap?.surcharges.length ?? 0;
  const ready = totalZones > 0 && (snap?.weightTiers.length ?? 0) > 0;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Calculator className="size-3.5" />
          Calculator
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Try a quote</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Pick a destination + weight and the engine returns the customer-facing rate with a line-by-line breakdown. Every calculation is logged for audit.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Countries quotable" value={String(totalZones)} sub={totalZones === 0 ? 'Add zones first' : 'Across all zones'} />
        <StatTile label="Weight tiers" value={String(snap?.weightTiers.length ?? 0)} sub="Configured" />
        <StatTile label="Active surcharges" value={String(surcharges)} sub={surcharges === 0 ? 'Base rate only' : 'Stacking'} />
      </div>

      <Card>
        <CardContent className="p-6 md:p-8">
          {!ready ? (
            <div className="text-center py-12">
              <div className="text-sm font-medium">Not enough data to quote yet</div>
              <div className="text-xs text-muted-foreground mt-1 mb-6">
                You need at least one zone with a country assigned and one weight tier with a filled rate cell.
              </div>
              <div className="flex items-center justify-center gap-3 text-xs flex-wrap">
                <Link href={`/f/carrier-rates/${id}/workspace`} className="text-primary hover:underline">Open rate workspace →</Link>
                <Link href={`/f/carrier-rates/${id}/weight-tiers`} className="text-primary hover:underline">Add tiers →</Link>
                <Link href={`/f/carrier-rates/${id}/workspace`} className="text-primary hover:underline">Open rate workspace →</Link>
              </div>
            </div>
          ) : (
            <QuoteForm
              costCurrency={account.costCurrency}
              displayCurrency={account.displayCurrency}
              countryOptions={countryOptions}
              runQuoteAction={runQuoteAction}
            />
          )}
        </CardContent>
      </Card>
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
