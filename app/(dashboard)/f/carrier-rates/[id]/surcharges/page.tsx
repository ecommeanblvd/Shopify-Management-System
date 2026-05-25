import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ChevronLeft, Wrench, Plus, Trash2, Flame, CalendarDays, MapPin, Home, TrendingUp, Leaf, Power,
} from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import {
  listSurcharges, createSurcharge, updateSurcharge, deleteSurcharge,
  type SurchargeKind, type SurchargeRow,
} from '@/features/carrier-rates/surcharges-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

interface KindMeta {
  label: string;
  desc: string;
  unit: 'percent' | 'amount' | 'amount_per_kg';
  icon: React.ReactNode;
  accent: string; // tailwind text color class for icon tint
}

const KIND_META: Record<SurchargeKind, KindMeta> = {
  fuel_percent:      { label: 'Fuel surcharge',     desc: 'Percentage of the base rate. Published weekly by DHL/FedEx.',         unit: 'percent',       icon: <Flame className="size-4" />,        accent: 'text-amber-500' },
  peak_fixed:        { label: 'Peak / premium',     desc: 'Flat fee per shipment. Use for peak season or premium services.',     unit: 'amount',        icon: <CalendarDays className="size-4" />, accent: 'text-rose-500' },
  remote_fixed:      { label: 'Remote area',        desc: 'Flat fee when destination postcode matches the remote list.',         unit: 'amount',        icon: <MapPin className="size-4" />,       accent: 'text-orange-500' },
  residential_fixed: { label: 'Residential',        desc: 'Flat fee when the destination is a residential address.',             unit: 'amount',        icon: <Home className="size-4" />,         accent: 'text-sky-500' },
  markup_percent:    { label: 'Markup',             desc: 'Your profit margin percentage applied to the (base + surcharges).',   unit: 'percent',       icon: <TrendingUp className="size-4" />,   accent: 'text-emerald-500' },
  per_kg_fixed:      { label: 'Per-kg fixed',       desc: 'Flat amount × shipment weight. Use for SAF, GoGreen, fuel-equiv.',    unit: 'amount_per_kg', icon: <Leaf className="size-4" />,         accent: 'text-emerald-500' },
};

const KIND_ORDER: SurchargeKind[] = [
  'fuel_percent', 'peak_fixed', 'remote_fixed', 'residential_fixed', 'per_kg_fixed', 'markup_percent',
];

const VND_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatValue(kind: SurchargeKind, raw: string, currency: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const meta = KIND_META[kind];
  if (meta.unit === 'percent') return `${n}%`;
  if (meta.unit === 'amount_per_kg') return `${VND_FMT.format(Math.round(n))} ${currency}/kg`;
  return `${VND_FMT.format(Math.round(n))} ${currency}`;
}

async function createAction(accountId: string, userId: string, formData: FormData) {
  'use server';
  const kind = String(formData.get('kind') ?? '') as SurchargeKind;
  const value = String(formData.get('value') ?? '');
  const note = String(formData.get('note') ?? '');
  await createSurcharge({ carrierAccountId: accountId, kind, value, note }, userId);
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

async function updateAction(accountId: string, id: string, userId: string, formData: FormData) {
  'use server';
  const value = formData.get('value');
  const note = formData.get('note');
  const activeRaw = formData.get('active');
  const patch: { value?: string; note?: string; active?: boolean } = {};
  if (value !== null) patch.value = String(value);
  if (note !== null) patch.note = String(note);
  if (activeRaw !== null) patch.active = activeRaw === 'true';
  await updateSurcharge({ id, ...patch }, userId);
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

async function deleteAction(accountId: string, id: string) {
  'use server';
  await deleteSurcharge(id);
  revalidatePath(`/f/carrier-rates/${accountId}/surcharges`);
}

export default async function SurchargesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
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

  const createBound = createAction.bind(null, id, session.user.id);

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Wrench className="size-3.5" />
          Surcharges
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Stacked fees &amp; markup</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Each active surcharge folds into the quote on top of the base rate. Fuel %, peak/premium flat,
          remote, residential, per-kg green levies, and the operator markup all stack here.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Total" value={String(surcharges.length)} sub={surcharges.length === 1 ? 'surcharge' : 'surcharges'} />
        <StatTile label="Active" value={String(totalActive)} sub={`${surcharges.length - totalActive} disabled`} />
        <StatTile label="Currency" value={account.costCurrency} sub="for fixed amounts" />
      </div>

      {canManage && (
        <Card>
          <CardContent className="p-5 md:p-6">
            <form action={createBound} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_2fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kind</Label>
                <select
                  name="kind"
                  className="w-full border border-input bg-input/30 rounded-lg px-3 h-9 text-sm"
                  defaultValue="fuel_percent"
                >
                  {KIND_ORDER.map((k) => (
                    <option key={k} value={k}>{KIND_META[k].label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Value</Label>
                <Input name="value" required placeholder="30 or 150000" className="font-mono tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Note (optional)</Label>
                <Input name="note" placeholder="e.g. Premium 9:00 service" />
              </div>
              <Button type="submit" className="gap-1.5 h-9">
                <Plus className="size-4" />
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {KIND_ORDER.map((kind) => {
          const list = byKind.get(kind) ?? [];
          const meta = KIND_META[kind];
          if (list.length === 0 && !canManage) return null;
          return (
            <section key={kind} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={`size-8 rounded-lg bg-muted flex items-center justify-center ${meta.accent}`}>
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold tracking-tight">{meta.label}</h2>
                  <p className="text-xs text-muted-foreground">{meta.desc}</p>
                </div>
                <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
                  {list.length} configured
                </Badge>
              </div>

              {list.length === 0 ? (
                <Card>
                  <CardContent className="px-5 py-4">
                    <p className="text-xs text-muted-foreground italic">None set.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {list.map((s) => (
                    <SurchargeRow
                      key={s.id}
                      accountId={id}
                      row={s}
                      currency={account.costCurrency}
                      canManage={canManage}
                      updateBound={updateAction.bind(null, id, s.id, session.user.id)}
                      deleteBound={deleteAction.bind(null, id, s.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface SurchargeRowProps {
  accountId: string;
  row: SurchargeRow;
  currency: string;
  canManage: boolean;
  updateBound: (formData: FormData) => void | Promise<void>;
  deleteBound: () => void | Promise<void>;
}

function SurchargeRow({ row, currency, canManage, updateBound, deleteBound }: SurchargeRowProps) {
  const meta = KIND_META[row.kind];
  const unitSuffix = meta.unit === 'percent' ? '%' : meta.unit === 'amount_per_kg' ? `${currency}/kg` : currency;

  return (
    <Card className={row.active ? '' : 'opacity-60'}>
      <CardContent className="px-5 py-4">
        <form action={updateBound} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto] gap-3 items-center">
          <div className="flex items-center gap-3">
            <Input
              name="value"
              defaultValue={row.value}
              className="font-mono tabular-nums w-32"
              disabled={!canManage}
            />
            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{unitSuffix}</span>
            {row.tier && (
              <Badge variant="secondary" className="h-5 text-[10px] uppercase tracking-wider whitespace-nowrap shrink-0">
                {row.tier}
              </Badge>
            )}
          </div>
          <Input
            name="note"
            defaultValue={row.note ?? ''}
            placeholder="Optional note"
            disabled={!canManage}
            className="text-sm"
          />
          <div className="flex items-center gap-1.5">
            <input type="hidden" name="active" value={row.active ? 'false' : 'true'} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={!canManage}
              className="h-8 px-2 gap-1 text-xs"
              aria-label={row.active ? 'Disable surcharge' : 'Enable surcharge'}
              title={row.active ? 'Disable surcharge' : 'Enable surcharge'}
            >
              <Power className={`size-3.5 ${row.active ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              {row.active ? 'On' : 'Off'}
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            {canManage && (
              <Button type="submit" size="sm" variant="outline" className="h-8 px-3 text-xs">
                Save
              </Button>
            )}
          </div>
        </form>
        {canManage && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              Last updated {new Date(row.updatedAt).toLocaleString()} · current: <span className="font-mono tabular-nums text-foreground/80">{formatValue(row.kind, row.value, currency)}</span>
            </div>
            <form action={deleteBound}>
              <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2 gap-1 text-xs">
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
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
