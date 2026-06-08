import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Globe2, Plus, Trash2, AlertCircle, X } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { listZonesWithCountries, createZone, deleteZone, patchZoneCountries, renameZone } from '@/features/carrier-rates/zones-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { iso2ToFlag, countryName, CountryChip } from '@/components/carrier-rates/country-display';

export const dynamic = 'force-dynamic';

const ISO2_RE = /^[A-Z]{2}$/;

async function addZoneAction(accountId: string, formData: FormData) {
  'use server';
  const label = String(formData.get('label') ?? '');
  await createZone(accountId, label);
  revalidatePath(`/f/carrier-rates/${accountId}/zones`);
}

async function deleteZoneAction(accountId: string, zoneId: string) {
  'use server';
  await deleteZone(zoneId);
  revalidatePath(`/f/carrier-rates/${accountId}/zones`);
}

async function renameZoneAction(accountId: string, zoneId: string, formData: FormData) {
  'use server';
  const label = String(formData.get('label') ?? '');
  await renameZone(zoneId, label);
  revalidatePath(`/f/carrier-rates/${accountId}/zones`);
}

async function setCountriesAction(accountId: string, zoneId: string, existing: string[], formData: FormData) {
  'use server';
  const raw = String(formData.get('countries') ?? '');
  const next = Array.from(new Set(raw.split(/[,\s]+/).map((c) => c.trim().toUpperCase()))).filter(Boolean);
  const existingSet = new Set(existing);
  const nextSet = new Set(next);
  const add = next.filter((c) => !existingSet.has(c));
  const remove = existing.filter((c) => !nextSet.has(c));
  await patchZoneCountries(zoneId, accountId, { add, remove });
  revalidatePath(`/f/carrier-rates/${accountId}/zones`);
}

export default async function ZonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zone?: string }>;
}) {
  const { id } = await params;
  const { zone: activeZoneId } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const zones = await listZonesWithCountries(id);
  const totalCountries = zones.reduce((sum, z) => sum + z.countries.length, 0);

  const addBound = addZoneAction.bind(null, id);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Globe2 className="size-3.5" />
          Zones
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Zone scheme</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Click any zone to edit. A country can sit in only one zone per account.
        </p>
      </header>

      {zones.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <StatTile label="Zones" value={String(zones.length)} sub="Configured" />
          <StatTile label="Countries assigned" value={String(totalCountries)} sub="Across all zones" />
          <StatTile label="Avg per zone" value={zones.length === 0 ? '—' : (totalCountries / zones.length).toFixed(1)} sub="Countries" />
        </div>
      )}

      {canManage && (
        <Card>
          <CardContent className="p-5 md:p-6">
            <form action={addBound} className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">New zone label</Label>
                <Input name="label" required placeholder="Zone 1, Zone A, Domestic…" />
              </div>
              <Button type="submit" className="gap-1.5">
                <Plus className="size-4" />
                Add zone
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {zones.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Globe2 className="size-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-medium">No zones yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              {canManage ? 'Add the first zone above.' : 'Ask an admin to configure zones.'}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {zones.map((z) => {
            const isActive = activeZoneId === z.id;
            return (
              <div key={z.id} className={isActive ? 'lg:col-span-2' : ''}>
                {isActive ? (
                  <ZoneEditCard
                    accountId={id}
                    zone={z}
                    canManage={canManage}
                    renameAction={renameZoneAction.bind(null, id, z.id)}
                    setCountriesAction={setCountriesAction.bind(null, id, z.id, z.countries)}
                    deleteAction={deleteZoneAction.bind(null, id, z.id)}
                  />
                ) : (
                  <ZonePreviewCard accountId={id} zone={z} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Zone {
  id: string;
  label: string;
  position: number;
  countries: string[];
}

function ZonePreviewCard({ accountId, zone }: { accountId: string; zone: Zone }) {
  const previewLimit = 8;
  const previewed = zone.countries.slice(0, previewLimit);
  const remaining = zone.countries.length - previewed.length;

  return (
    <Link
      href={`/f/carrier-rates/${accountId}/zones?zone=${zone.id}#${zone.id}`}
      className="group block h-full"
      id={zone.id}
    >
      <Card className="hover:border-foreground/30 hover:bg-card/80 transition-colors h-full">
        <CardContent className="p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{zone.label}</h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider shrink-0">
              {zone.countries.length} {zone.countries.length === 1 ? 'country' : 'countries'}
            </Badge>
          </div>

          {zone.countries.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No countries assigned · click to add some
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {previewed.map((c) => <CountryChip key={c} code={c} />)}
              {remaining > 0 && (
                <div className="inline-flex items-center px-2 py-1 rounded-md border border-dashed border-border text-xs text-muted-foreground">
                  +{remaining} more
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-border text-xs text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1">
            Click to edit →
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface ZoneEditCardProps {
  accountId: string;
  zone: Zone;
  canManage: boolean;
  renameAction: (formData: FormData) => void | Promise<void>;
  setCountriesAction: (formData: FormData) => void | Promise<void>;
  deleteAction: () => void | Promise<void>;
}

function ZoneEditCard({
  accountId, zone, canManage, renameAction, setCountriesAction, deleteAction,
}: ZoneEditCardProps) {
  const validCountries = zone.countries.filter((c) => ISO2_RE.test(c));
  const invalidCount = zone.countries.length - validCountries.length;

  return (
    <Card className="border-primary/40 bg-primary/[0.02]" id={zone.id}>
      <CardContent className="p-5 md:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {canManage ? (
              <form action={renameAction} className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  name="label"
                  defaultValue={zone.label}
                  className="text-lg font-semibold tracking-tight max-w-xs"
                  required
                />
                <Button type="submit" variant="ghost" size="sm" className="h-8 px-3 text-xs shrink-0">
                  Rename
                </Button>
              </form>
            ) : (
              <h2 className="text-lg font-semibold tracking-tight">{zone.label}</h2>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="h-6 text-[10px] uppercase tracking-wider">
              {zone.countries.length} {zone.countries.length === 1 ? 'country' : 'countries'}
            </Badge>
            <Link
              href={`/f/carrier-rates/${accountId}/zones`}
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close editor"
            >
              <X className="size-4" />
            </Link>
          </div>
        </div>

        {validCountries.length > 0 && (
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Current countries</Label>
            <div className="flex flex-wrap gap-2">
              {validCountries.map((c) => <CountryChip key={c} code={c} />)}
            </div>
          </div>
        )}

        {canManage ? (
          <form action={setCountriesAction} className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Countries (ISO-2, comma-separated)</Label>
            <Input
              name="countries"
              defaultValue={zone.countries.join(', ')}
              placeholder="VN, TH, SG, MY"
              className="font-mono"
            />
            {invalidCount > 0 && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="size-3" />
                {invalidCount} entry not a valid ISO-2 code — will be rejected on save.
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
              <form action={deleteAction}>
                <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5">
                  <Trash2 className="size-3.5" />
                  Delete zone
                </Button>
              </form>
              <Button type="submit" className="gap-1.5">
                Save countries
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Read-only view. Ask an admin to edit.</p>
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
