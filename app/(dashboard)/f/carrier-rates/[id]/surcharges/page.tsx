import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ChevronLeft, Wrench, Flame, CalendarDays, MapPin, Home, TrendingUp, Leaf, Power, Pencil,
  RefreshCw, Zap,
} from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import {
  listSurcharges, createSurcharge, updateSurcharge, deleteSurcharge,
  type SurchargeKind, type SurchargeRow,
} from '@/features/carrier-rates/surcharges-actions';
import { refreshFedExFuel } from '@/features/carrier-rates/fuel-fetcher/apply';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SurchargeEditDialog } from '@/components/carrier-rates/SurchargeEditDialog';

export const dynamic = 'force-dynamic';

interface KindMeta {
  label: string;
  desc: string;
  formula: string;
  unit: 'percent' | 'amount' | 'amount_per_kg';
  icon: React.ReactNode;
  accent: string; // tailwind text color class for icon tint
  /** Background tint behind the icon — chosen per kind so sections feel distinct. */
  accentBg: string;
  /** Whether to show the optional per-kg companion input (max-of-two billing). */
  supportsPerKg: boolean;
}

const KIND_META: Record<SurchargeKind, KindMeta> = {
  fuel_percent: {
    label: 'Fuel surcharge',
    desc: 'Percentage of the base rate. Published weekly by DHL/FedEx.',
    formula: 'base × (value ÷ 100)',
    unit: 'percent',
    icon: <Flame className="size-4" />,
    accent: 'text-amber-600 dark:text-amber-400',
    accentBg: 'bg-amber-500/10',
    supportsPerKg: false,
  },
  peak_fixed: {
    label: 'Peak / premium',
    desc: 'Flat fee per shipment. Use for peak season or premium services.',
    formula: '+ value',
    unit: 'amount',
    icon: <CalendarDays className="size-4" />,
    accent: 'text-rose-600 dark:text-rose-400',
    accentBg: 'bg-rose-500/10',
    supportsPerKg: false,
  },
  remote_fixed: {
    label: 'Remote area',
    desc: 'Flat fee when destination postcode matches the remote list. Optional max(flat, per-kg) billing for tier B/C.',
    formula: 'max(value, perKg × weight) when both set',
    unit: 'amount',
    icon: <MapPin className="size-4" />,
    accent: 'text-orange-600 dark:text-orange-400',
    accentBg: 'bg-orange-500/10',
    supportsPerKg: true,
  },
  residential_fixed: {
    label: 'Residential',
    desc: 'Flat fee when the destination is a residential address.',
    formula: '+ value',
    unit: 'amount',
    icon: <Home className="size-4" />,
    accent: 'text-sky-600 dark:text-sky-400',
    accentBg: 'bg-sky-500/10',
    supportsPerKg: false,
  },
  markup_percent: {
    label: 'Markup',
    desc: 'Your profit margin percentage applied to (base + surcharges).',
    formula: 'subtotal × (value ÷ 100)',
    unit: 'percent',
    icon: <TrendingUp className="size-4" />,
    accent: 'text-emerald-600 dark:text-emerald-400',
    accentBg: 'bg-emerald-500/10',
    supportsPerKg: false,
  },
  per_kg_fixed: {
    label: 'Per-kg fixed',
    desc: 'Flat amount × shipment weight. Use for SAF, GoGreen, fuel-equiv levies.',
    formula: 'value × weight',
    unit: 'amount_per_kg',
    icon: <Leaf className="size-4" />,
    accent: 'text-emerald-600 dark:text-emerald-400',
    accentBg: 'bg-emerald-500/10',
    supportsPerKg: false,
  },
};

const KIND_ORDER: SurchargeKind[] = [
  'fuel_percent', 'peak_fixed', 'remote_fixed', 'residential_fixed', 'per_kg_fixed', 'markup_percent',
];

const VND_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function unitSuffixFor(kind: SurchargeKind, currency: string): string {
  const u = KIND_META[kind].unit;
  if (u === 'percent') return '%';
  if (u === 'amount_per_kg') return `${currency}/kg`;
  return currency;
}

function formatValue(kind: SurchargeKind, raw: string, currency: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const meta = KIND_META[kind];
  if (meta.unit === 'percent') return `${n}%`;
  if (meta.unit === 'amount_per_kg') return `${VND_FMT.format(Math.round(n))} ${currency}/kg`;
  return `${VND_FMT.format(Math.round(n))} ${currency}`;
}

async function createAction(accountId: string, kind: SurchargeKind, userId: string, formData: FormData) {
  'use server';
  const value = String(formData.get('value') ?? '');
  const valuePerKg = formData.get('valuePerKg');
  const note = String(formData.get('note') ?? '');
  await createSurcharge(
    {
      carrierAccountId: accountId,
      kind,
      value,
      valuePerKg: valuePerKg !== null ? String(valuePerKg) : undefined,
      note,
    },
    userId,
  );
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

async function updateAction(accountId: string, id: string, userId: string, formData: FormData) {
  'use server';
  const value = formData.get('value');
  const valuePerKg = formData.get('valuePerKg');
  const note = formData.get('note');
  const activeRaw = formData.get('active');
  const patch: { value?: string; valuePerKg?: string; note?: string; active?: boolean } = {};
  if (value !== null) patch.value = String(value);
  if (valuePerKg !== null) patch.valuePerKg = String(valuePerKg);
  if (note !== null) patch.note = String(note);
  // checkbox absent in FormData when unchecked → treat as false; present → true
  patch.active = activeRaw !== null;
  await updateSurcharge({ id, ...patch }, userId);
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

async function deleteAction(accountId: string, id: string) {
  'use server';
  await deleteSurcharge(id);
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

/**
 * Fetch the current weekly fuel surcharge directly from FedEx's public AEM
 * endpoint, then upsert it into this account's `fuel_percent` row. Bound at
 * call-site with the accountId + the operator's user id so the row records
 * who triggered the refresh.
 *
 * Scoped to the FedEx carrier — the page only mounts this button when
 * `account.carrierKey === 'fedex'`.
 */
async function refreshFuelAction(accountId: string, userId: string) {
  'use server';
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_carrier_rates')) {
    throw new Error('forbidden');
  }
  await refreshFedExFuel({ carrierAccountId: accountId, triggeredBy: userId });
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

export default async function SurchargesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const surcharges = await listSurcharges(id);

  // Group by kind
  const byKind = new Map<SurchargeKind, SurchargeRow[]>();
  for (const k of KIND_ORDER) byKind.set(k, []);
  for (const s of surcharges) byKind.get(s.kind)?.push(s);

  const totalActive = surcharges.filter((s) => s.active).length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href={`/f/carrier-rates/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Wrench className="size-3.5" />
          Surcharges
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Stacked fees &amp; markup</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Each active surcharge folds into the quote on top of the base rate. Fuel %, peak/premium flat,
          remote, residential, per-kg green levies, and the operator markup all stack here. Click any row
          to edit; click the dashed “Add” strip at the bottom of a section to create a new one.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Total" value={String(surcharges.length)} sub={surcharges.length === 1 ? 'surcharge' : 'surcharges'} />
        <StatTile label="Active" value={String(totalActive)} sub={`${surcharges.length - totalActive} disabled`} />
        <StatTile label="Currency" value={account.costCurrency} sub="for fixed amounts" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {KIND_ORDER.map((kind) => {
          const list = byKind.get(kind) ?? [];
          const meta = KIND_META[kind];
          if (list.length === 0 && !canManage) return null;
          return (
            <KindCard
              key={kind}
              kind={kind}
              meta={meta}
              list={list}
              accountId={id}
              userId={session.user.id}
              currency={account.costCurrency}
              carrierKey={account.carrierKey}
              canManage={canManage}
            />
          );
        })}
      </div>
    </div>
  );
}

interface KindCardProps {
  kind: SurchargeKind;
  meta: KindMeta;
  list: SurchargeRow[];
  accountId: string;
  userId: string;
  currency: string;
  /** Carrier brand (`'fedex'`, `'dhl'`, ...) — gates the auto-refresh button. */
  carrierKey: string | null | undefined;
  canManage: boolean;
}

function KindCard({
  kind, meta, list, accountId, userId, currency, carrierKey, canManage,
}: KindCardProps) {
  const unitSuffix = unitSuffixFor(kind, currency);
  const perKgUnitSuffix = kind === 'remote_fixed' ? `${currency}/kg` : undefined;
  const activeCount = list.filter((s) => s.active).length;
  // FedEx publishes a weekly fuel % we can scrape directly off their
  // surcharges page. DHL would need a separate scraper — surface only when
  // we actually have one wired up.
  const supportsAutoRefresh = kind === 'fuel_percent' && carrierKey === 'fedex';
  const lastAutoFetchedAt = supportsAutoRefresh
    ? list.find((s) => s.lastAutoFetchedAt)?.lastAutoFetchedAt ?? null
    : null;
  const lastAutoSource = supportsAutoRefresh
    ? list.find((s) => s.lastAutoFetchedAt)?.lastAutoSource ?? null
    : null;
  const refreshBound = supportsAutoRefresh && canManage
    ? refreshFuelAction.bind(null, accountId, userId)
    : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Section header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${meta.accentBg} ${meta.accent}`}>
            {meta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold tracking-tight">{meta.label}</h2>
              <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
                {list.length === 0 ? 'none' : `${activeCount}/${list.length} on`}
              </Badge>
              {supportsAutoRefresh && (
                <Badge variant="secondary" className="h-5 text-[10px] uppercase tracking-wider gap-1 px-1.5">
                  <Zap className="size-2.5" />
                  Auto
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{meta.desc}</p>
            <p className="text-[10px] font-mono text-muted-foreground/80 mt-1">
              {meta.formula}
            </p>
            {supportsAutoRefresh && (
              <p className="text-[10px] text-muted-foreground/80 mt-1">
                {lastAutoFetchedAt
                  ? <>Last auto-fetched <span className="font-mono">{new Date(lastAutoFetchedAt).toLocaleString()}</span>{lastAutoSource && <> · <span className="font-mono">{lastAutoSource}</span></>}</>
                  : <>No auto-fetch yet — click <span className="font-mono">Refresh from FedEx</span> to pull the current weekly %.</>}
              </p>
            )}
          </div>
          {refreshBound && (
            <form action={refreshBound}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs gap-1.5 shrink-0"
                title="Pull the current week from fedex.com"
              >
                <RefreshCw className="size-3" />
                Refresh
              </Button>
            </form>
          )}
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {list.length === 0 ? (
            <div className="px-5 py-6 text-xs text-muted-foreground italic text-center">
              No {meta.label.toLowerCase()} configured.
            </div>
          ) : (
            list.map((s) => (
              <SurchargeSummaryRow
                key={s.id}
                row={s}
                meta={meta}
                unitSuffix={unitSuffix}
                perKgUnitSuffix={perKgUnitSuffix}
                currency={currency}
                canManage={canManage}
                accountId={accountId}
                userId={userId}
              />
            ))
          )}
        </div>

        {/* Add row */}
        {canManage && (
          <div className="px-5 py-3 bg-muted/20">
            <SurchargeEditDialog
              triggerLabel={`Add ${meta.label.toLowerCase()}`}
              triggerVariant="ghost-add-row"
              title={`Add ${meta.label.toLowerCase()}`}
              description={meta.desc}
              unitSuffix={unitSuffix}
              perKgUnitSuffix={perKgUnitSuffix}
              defaultValue=""
              defaultPerKgValue=""
              defaultNote=""
              defaultActive
              perKgVisible={meta.supportsPerKg}
              saveAction={createAction.bind(null, accountId, kind, userId)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface SurchargeSummaryRowProps {
  row: SurchargeRow;
  meta: KindMeta;
  unitSuffix: string;
  perKgUnitSuffix: string | undefined;
  currency: string;
  canManage: boolean;
  accountId: string;
  userId: string;
}

function SurchargeSummaryRow({
  row, meta, unitSuffix, perKgUnitSuffix, currency, canManage, accountId, userId,
}: SurchargeSummaryRowProps) {
  const perKgNumber = row.valuePerKg !== null ? Number(row.valuePerKg) : null;
  const hasPerKg = perKgNumber !== null && Number.isFinite(perKgNumber) && perKgNumber > 0;

  return (
    <div className={`flex items-center gap-3 px-5 py-3 ${row.active ? '' : 'opacity-60'}`}>
      <Power
        className={`size-3.5 shrink-0 ${row.active ? 'text-emerald-500' : 'text-muted-foreground'}`}
        aria-label={row.active ? 'Active' : 'Inactive'}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono tabular-nums text-sm font-semibold text-foreground">
            {formatValue(row.kind, row.value, currency)}
          </span>
          {row.tier && (
            <Badge variant="secondary" className="h-4 text-[9px] uppercase tracking-wider px-1.5">
              {row.tier}
            </Badge>
          )}
          {hasPerKg && perKgNumber !== null && (
            <span className="text-[11px] text-muted-foreground font-mono">
              or {VND_FMT.format(perKgNumber)} {currency}/kg
              <span className="ml-1 not-italic opacity-70">(max)</span>
            </span>
          )}
        </div>
        {row.note && (
          <div className="text-xs text-muted-foreground truncate">{row.note}</div>
        )}
        <div className="text-[10px] text-muted-foreground/80">
          Updated {new Date(row.updatedAt).toLocaleString()}
        </div>
      </div>
      {canManage && (
        <SurchargeEditDialog
          triggerLabel="Edit"
          triggerVariant="outline-sm"
          title={`Edit ${meta.label.toLowerCase()}`}
          description={meta.desc}
          unitSuffix={unitSuffix}
          perKgUnitSuffix={perKgUnitSuffix}
          defaultValue={row.value}
          defaultPerKgValue={row.valuePerKg}
          defaultNote={row.note ?? ''}
          defaultActive={row.active}
          tier={row.tier}
          perKgVisible={meta.supportsPerKg}
          saveAction={updateAction.bind(null, accountId, row.id, userId)}
          deleteAction={deleteAction.bind(null, accountId, row.id)}
        />
      )}
      {!canManage && (
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Pencil className="size-3" />
          read-only
        </span>
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
