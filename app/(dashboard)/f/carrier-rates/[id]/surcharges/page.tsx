import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ChevronLeft, Wrench, Flame, CalendarDays, MapPin, Home, TrendingUp, Leaf, Power, Pencil,
  RefreshCw, Zap, Globe2, Receipt, PackageCheck, TicketPercent, PenLine,
} from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { currencyDecimals } from '@/lib/currency-format';
import { getAccount } from '@/features/carrier-rates/actions';
import { formatDateVN, formatExclusiveEndVN } from '@/features/carrier-rates/lib';
import {
  listSurcharges, createSurcharge, updateSurcharge, deleteSurcharge,
  type SurchargeKind, type SurchargeRow,
} from '@/features/carrier-rates/surcharges-actions';
import { refreshCarrierFuel } from '@/features/carrier-rates/fuel-fetcher/apply';
import { seedFedexVietnamDemand } from '@/features/carrier-rates/seed-fedex-vn-demand';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SurchargeEditDialog } from '@/components/carrier-rates/SurchargeEditDialog';
import { FuelHistoryDialog } from '@/components/carrier-rates/FuelHistoryDialog';

/** Fuel surcharge has a long weekly history — show only the latest few inline. */
const FUEL_INLINE_LIMIT = 5;

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
  demand_per_kg: {
    label: 'Demand surcharge',
    desc: 'Country/region-scoped per-kg fee. Used by FedEx Demand Surcharge — different VND/kg for each destination group. Multiple rows can overlap and compound.',
    formula: 'value × weight (when destination in country list)',
    unit: 'amount_per_kg',
    icon: <Globe2 className="size-4" />,
    accent: 'text-fuchsia-600 dark:text-fuchsia-400',
    accentBg: 'bg-fuchsia-500/10',
    supportsPerKg: false,
  },
  country_fixed: {
    label: 'Country fixed fee',
    desc: 'Country-scoped FLAT per-shipment fee. Used by FedEx VN "Phí xử lý hàng nhập tại Hoa Kỳ" (US import handling / Duty Prepaid). Fuel applies on top.',
    formula: '+ value (when destination in country list)',
    unit: 'amount',
    icon: <PackageCheck className="size-4" />,
    accent: 'text-violet-600 dark:text-violet-400',
    accentBg: 'bg-violet-500/10',
    supportsPerKg: false,
  },
  vat_percent: {
    label: 'VAT',
    desc: 'Value-added tax applied on (base + surcharges + fuel). FedEx Vietnam: 8 %.',
    formula: '(base + surcharges + fuel) × (value ÷ 100)',
    unit: 'percent',
    icon: <Receipt className="size-4" />,
    accent: 'text-cyan-600 dark:text-cyan-400',
    accentBg: 'bg-cyan-500/10',
    supportsPerKg: false,
  },
  per_step_fixed: {
    label: 'Per step',
    desc: 'Stepped per-weight fee — e.g. DHL GoGreen Plus 1,900 VND × every 0.5 kg.',
    formula: 'ceil(weight ÷ step_kg) × value',
    unit: 'amount',
    icon: <PackageCheck className="size-4" />,
    accent: 'text-lime-600 dark:text-lime-400',
    accentBg: 'bg-lime-500/10',
    supportsPerKg: false,
  },
  contract_discount_pct: {
    label: 'Volume discount',
    desc: 'Negotiated discount off the published base — FedEx Total Discount line. Per-country via country_codes (e.g. US 68 %, SA 77 %).',
    formula: '− base × (value ÷ 100)',
    unit: 'percent',
    icon: <TicketPercent className="size-4" />,
    accent: 'text-emerald-600 dark:text-emerald-400',
    accentBg: 'bg-emerald-500/10',
    supportsPerKg: false,
  },
  addon_fixed: {
    label: 'Dịch vụ bổ sung',
    desc: 'Phí dịch vụ cộng thêm theo lô hàng (Direct Signature…). Chế độ "always" cộng vào mọi quote; "when_billed" chỉ dùng làm giá tham chiếu khi đối soát.',
    formula: "+ value (luôn) hoặc giá tham chiếu (khi bill có)",
    unit: 'amount',
    icon: <PenLine className="size-4" />,
    accent: 'text-violet-600 dark:text-violet-400',
    accentBg: 'bg-violet-500/10',
    supportsPerKg: false,
  },
};

const KIND_ORDER: SurchargeKind[] = [
  'fuel_percent', 'peak_fixed', 'addon_fixed', 'remote_fixed', 'residential_fixed', 'per_kg_fixed', 'per_step_fixed', 'demand_per_kg', 'country_fixed', 'contract_discount_pct', 'vat_percent', 'markup_percent',
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
  const countryCodes = formData.get('countryCodes');
  const note = String(formData.get('note') ?? '');
  const applyModeRaw = kind === 'addon_fixed' ? String(formData.get('applyMode') ?? 'always') : undefined;
  const applyMode: 'always' | 'when_billed' | undefined =
    applyModeRaw === 'when_billed' ? 'when_billed' : applyModeRaw !== undefined ? 'always' : undefined;
  await createSurcharge(
    {
      carrierAccountId: accountId,
      kind,
      value,
      valuePerKg: valuePerKg !== null ? String(valuePerKg) : undefined,
      countryCodes: countryCodes !== null ? String(countryCodes) : undefined,
      note,
      applyMode,
    },
    userId,
  );
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

async function updateAction(accountId: string, id: string, userId: string, formData: FormData) {
  'use server';
  const value = formData.get('value');
  const valuePerKg = formData.get('valuePerKg');
  const countryCodes = formData.get('countryCodes');
  const note = formData.get('note');
  const activeRaw = formData.get('active');
  const applyModeRaw = formData.get('applyMode');
  const patch: {
    value?: string; valuePerKg?: string; countryCodes?: string; note?: string; active?: boolean;
    applyMode?: 'always' | 'when_billed';
  } = {};
  if (value !== null) patch.value = String(value);
  if (valuePerKg !== null) patch.valuePerKg = String(valuePerKg);
  if (countryCodes !== null) patch.countryCodes = String(countryCodes);
  if (note !== null) patch.note = String(note);
  // checkbox absent in FormData when unchecked → treat as false; present → true
  patch.active = activeRaw !== null;
  if (applyModeRaw !== null) {
    patch.applyMode = applyModeRaw === 'when_billed' ? 'when_billed' : 'always';
  }
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
  // Carrier-agnostic — dispatches to the FedEx or DHL fetcher based on
  // the carrier key linked to this account.
  await refreshCarrierFuel({ carrierAccountId: accountId, triggeredBy: userId });
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

/**
 * One-click insert of the published FedEx Vietnam → world Demand
 * Surcharge table. Idempotent (skips rows whose value + country list
 * already exist), so the operator can re-run safely after tweaking
 * individual rows.
 */
async function seedFedexVnDemandAction(accountId: string, userId: string) {
  'use server';
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_carrier_rates')) {
    throw new Error('forbidden');
  }
  await seedFedexVietnamDemand(accountId, userId);
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
  // Pass through MoneyInput formatting hints — `undefined` means "render as
  // plain Input" (percent / dimensionless), a number means "render with
  // thousand separators and this many decimal places".
  const moneyDecimals = currencyDecimals(currency);
  const valueDecimals = meta.unit === 'percent' ? undefined : moneyDecimals;
  const perKgDecimals = meta.supportsPerKg ? moneyDecimals : undefined;
  // Country scope is only meaningful for `demand_per_kg` — every other kind
  // applies globally so we hide the input to keep the dialog minimal.
  const countriesVisible = kind === 'demand_per_kg' || kind === 'country_fixed';
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

  // One-click seed of the FedEx Vietnam Demand Surcharge table. Only
  // exposed on the Demand section of a FedEx account that hasn't been
  // seeded yet — once a row exists, the operator manages from there.
  const supportsDemandSeed = kind === 'demand_per_kg' && carrierKey === 'fedex';
  const seedDemandBound = supportsDemandSeed && canManage && list.length === 0
    ? seedFedexVnDemandAction.bind(null, accountId, userId)
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
          {seedDemandBound && (
            <form action={seedDemandBound}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs gap-1.5 shrink-0"
                title="Insert the 7 published FedEx Vietnam → world demand rows in one click. Idempotent; re-runs safely after edits."
              >
                <Zap className="size-3" />
                Seed Vietnam demand
              </Button>
            </form>
          )}
        </div>

        {/* Rows — fuel shows only the latest few inline; the rest live in a modal. */}
        <div className="divide-y divide-border">
          {list.length === 0 ? (
            <div className="px-5 py-6 text-xs text-muted-foreground italic text-center">
              No {meta.label.toLowerCase()} configured.
            </div>
          ) : (
            (kind === 'fuel_percent' ? list.slice(0, FUEL_INLINE_LIMIT) : list).map((s) => (
              <SurchargeSummaryRow
                key={s.id}
                row={s}
                meta={meta}
                unitSuffix={unitSuffix}
                perKgUnitSuffix={perKgUnitSuffix}
                valueDecimals={valueDecimals}
                perKgDecimals={perKgDecimals}
                countriesVisible={countriesVisible}
                currency={currency}
                canManage={canManage}
                accountId={accountId}
                userId={userId}
              />
            ))
          )}
        </div>

        {/* Full fuel history lives behind a modal so the long weekly list
            doesn't bury the rest of the surcharges. */}
        {kind === 'fuel_percent' && list.length > FUEL_INLINE_LIMIT && (
          <div className="px-5 py-3 border-t border-border flex justify-center">
            <FuelHistoryDialog
              count={list.length}
              rows={list.map((s) => ({
                value: s.value,
                from: s.startsAt ? s.startsAt.toISOString() : null,
                to: s.endsAt ? s.endsAt.toISOString() : null,
                note: s.note,
              }))}
            />
          </div>
        )}

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
              valueDecimals={valueDecimals}
              perKgDecimals={perKgDecimals}
              countriesVisible={countriesVisible}
              defaultValue=""
              defaultPerKgValue=""
              defaultNote=""
              defaultActive
              perKgVisible={meta.supportsPerKg}
              kind={kind}
              defaultApplyMode="always"
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
  valueDecimals: number | undefined;
  perKgDecimals: number | undefined;
  countriesVisible: boolean;
  currency: string;
  canManage: boolean;
  accountId: string;
  userId: string;
}

function SurchargeSummaryRow({
  row, meta, unitSuffix, perKgUnitSuffix, valueDecimals, perKgDecimals, countriesVisible,
  currency, canManage, accountId, userId,
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
          {(row.startsAt || row.endsAt) && (
            <Badge variant="outline" className="h-4 text-[9px] font-mono tracking-wide px-1.5" title="Hiệu lực">
              {formatDateVN(row.startsAt, '…')}
              {' → '}
              {formatExclusiveEndVN(row.endsAt, 'nay')}
            </Badge>
          )}
          {row.tier && (
            <Badge variant="secondary" className="h-4 text-[9px] uppercase tracking-wider px-1.5">
              {row.tier}
            </Badge>
          )}
          {row.countryCodes && row.countryCodes.length > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground" title={row.countryCodes.join(', ')}>
              {row.countryCodes.length <= 4
                ? row.countryCodes.join(' · ')
                : `${row.countryCodes.slice(0, 3).join(' · ')} +${row.countryCodes.length - 3}`}
            </span>
          )}
          {(row.kind === 'demand_per_kg' || row.kind === 'country_fixed') && (!row.countryCodes || row.countryCodes.length === 0) && (
            <Badge variant="outline" className="h-4 text-[9px] uppercase tracking-wider px-1.5">
              all destinations
            </Badge>
          )}
          {row.kind === 'addon_fixed' && (
            <Badge
              variant="secondary"
              className={`h-4 text-[9px] uppercase tracking-wider px-1.5 ${
                row.applyMode === 'when_billed'
                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
                  : 'bg-violet-500/10 text-violet-700 dark:text-violet-400'
              }`}
            >
              {row.applyMode === 'when_billed' ? 'Kiểm khi có bill' : 'Luôn cộng'}
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
          valueDecimals={valueDecimals}
          perKgDecimals={perKgDecimals}
          countriesVisible={countriesVisible}
          defaultCountryCodes={row.countryCodes}
          defaultValue={row.value}
          defaultPerKgValue={row.valuePerKg}
          defaultNote={row.note ?? ''}
          defaultActive={row.active}
          tier={row.tier}
          perKgVisible={meta.supportsPerKg}
          kind={row.kind}
          defaultApplyMode={row.applyMode}
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
