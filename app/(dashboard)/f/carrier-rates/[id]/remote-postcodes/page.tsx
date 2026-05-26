import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, MapPin, Upload, Trash2, FileSpreadsheet, Plus } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import {
  loadPostcodeSummary, listPostcodesByCountry,
  addPostcode, deletePostcode, deletePostcodesByCountry, importPostcodes,
} from '@/features/carrier-rates/postcodes-actions';
import { parsePostcodeCsv } from '@/features/carrier-rates/postcodes-csv';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

export const dynamic = 'force-dynamic';

const ISO2_RE = /^[A-Z]{2}$/;
const FLAG_OFFSET = 0x1F1E6 - 'A'.charCodeAt(0);

function iso2ToFlag(code: string): string {
  if (!ISO2_RE.test(code)) return '🏳️';
  return [...code].map((c) => String.fromCodePoint(c.charCodeAt(0) + FLAG_OFFSET)).join('');
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code: string): string {
  if (!ISO2_RE.test(code)) return code;
  try { return REGION_NAMES.of(code) ?? code; } catch { return code; }
}

async function importCsvAction(accountId: string, userId: string, formData: FormData) {
  'use server';
  const csv = String(formData.get('csv') ?? '');
  const source = String(formData.get('source') ?? '').trim() || undefined;
  const parsed = parsePostcodeCsv(csv);
  await importPostcodes(accountId, parsed, userId, source);
  revalidatePath(`/f/carrier-rates/${accountId}/remote-postcodes`);
}

async function addOneAction(accountId: string, userId: string, formData: FormData) {
  'use server';
  const country = String(formData.get('country') ?? '');
  const pattern = String(formData.get('pattern') ?? '');
  const source = String(formData.get('source') ?? '').trim() || undefined;
  await addPostcode({ carrierAccountId: accountId, country, pattern, source, userId });
  revalidatePath(`/f/carrier-rates/${accountId}/remote-postcodes`);
}

async function deleteCountryAction(accountId: string, country: string) {
  'use server';
  await deletePostcodesByCountry(accountId, country);
  revalidatePath(`/f/carrier-rates/${accountId}/remote-postcodes`);
}

async function deleteOneAction(accountId: string, id: string) {
  'use server';
  await deletePostcode(id);
  revalidatePath(`/f/carrier-rates/${accountId}/remote-postcodes`);
}

export default async function RemotePostcodesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}) {
  const { id } = await params;
  const { country: activeCountry } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const summary = await loadPostcodeSummary(id);
  const countryRows = activeCountry && ISO2_RE.test(activeCountry.toUpperCase())
    ? await listPostcodesByCountry(id, activeCountry.toUpperCase())
    : null;

  const importBound = importCsvAction.bind(null, id, session.user.id);
  const addBound = addOneAction.bind(null, id, session.user.id);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MapPin className="size-3.5" />
          Remote postcodes
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Remote area lookup</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Upload the carrier&rsquo;s remote-area postcode list. The quote engine adds the remote-fixed
          surcharge whenever a destination postcode matches an entry below.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Total entries" value={summary.totalRows.toLocaleString()} sub={summary.totalRows === 0 ? 'Upload a list below' : 'Postcode patterns'} />
        <StatTile label="Countries covered" value={String(summary.countries.length)} sub={summary.countries.length === 0 ? '—' : 'With at least one entry'} />
        <StatTile label="Latest source" value={summary.recent[0]?.source ?? '—'} sub={summary.recent[0] ? new Date(summary.recent[0].uploadedAt).toLocaleDateString() : 'No uploads yet'} />
      </div>

      {/* Country list */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Countries</h2>
          {summary.countries.length > 0 && (
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {summary.countries.length} {summary.countries.length === 1 ? 'country' : 'countries'}
            </Badge>
          )}
        </div>

        {summary.countries.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <MapPin className="size-8 mx-auto text-muted-foreground mb-3" />
              <div className="text-sm font-medium">No remote postcodes yet</div>
              <div className="text-xs text-muted-foreground mt-1">Use the CSV import below to populate.</div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.countries.map(({ code, count }) => {
              const isActive = activeCountry?.toUpperCase() === code;
              return (
                <Link
                  key={code}
                  href={`/f/carrier-rates/${id}/remote-postcodes${isActive ? '' : `?country=${code}`}#country`}
                  className={
                    'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ' +
                    (isActive
                      ? 'border-primary/50 bg-primary/[0.04]'
                      : 'border-border bg-card hover:border-foreground/30')
                  }
                >
                  <span className="text-3xl leading-none" aria-hidden>{iso2ToFlag(code)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{countryName(code)}</div>
                    <div className="text-xs text-muted-foreground font-mono">{code}</div>
                  </div>
                  <Badge variant={isActive ? 'default' : 'secondary'} className="h-5 text-[10px] tabular-nums">
                    {count.toLocaleString()}
                  </Badge>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Country detail */}
      {countryRows && (
        <section id="country" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>{iso2ToFlag(activeCountry!.toUpperCase())}</span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{countryName(activeCountry!.toUpperCase())}</h2>
                <p className="text-xs text-muted-foreground font-mono">{activeCountry!.toUpperCase()} · {countryRows.length} {countryRows.length === 1 ? 'postcode' : 'postcodes'} (showing up to 200)</p>
              </div>
            </div>
            {canManage && (
              <form action={deleteCountryAction.bind(null, id, activeCountry!.toUpperCase())}>
                <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5">
                  <Trash2 className="size-3.5" />
                  Remove all for {activeCountry!.toUpperCase()}
                </Button>
              </form>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {countryRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-muted-foreground italic">No entries.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {countryRows.map((row) => (
                    <li key={row.id} className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="font-mono text-sm tabular-nums">{row.postcodePattern}</div>
                        {row.tier && (
                          <Badge variant="secondary" className="h-5 text-[10px] uppercase tracking-wider shrink-0">
                            {row.tier}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {row.source && <span className="font-mono truncate max-w-[180px]">{row.source}</span>}
                        <span>{new Date(row.uploadedAt).toLocaleDateString()}</span>
                        {canManage && (
                          <form action={deleteOneAction.bind(null, id, row.id)}>
                            <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {canManage && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
          {/* CSV import */}
          <Card>
            <CardContent className="p-6 md:p-8 space-y-5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wider">CSV import</h2>
                <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider ml-auto">Idempotent on (country, postcode)</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste rows in the format <span className="font-mono">country,postcode</span>. Header row optional; lines starting with <span className="font-mono">#</span> are skipped. Duplicates within the same file are collapsed and an existing entry is silently skipped on insert.
              </p>
              <form action={importBound} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="source" className="text-xs uppercase tracking-wider text-muted-foreground">Source label (optional)</Label>
                  <Input id="source" name="source" placeholder="DHL 2026Q1 remote areas" />
                </div>
                <Textarea
                  name="csv"
                  rows={10}
                  className="font-mono text-xs"
                  placeholder={['country,postcode', 'VN,710000', 'VN,711000', 'TH,10100'].join('\n')}
                  required
                />
                <div className="flex items-center justify-end">
                  <Button type="submit" className="gap-2">
                    <Upload className="size-4" />
                    Import
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Manual add */}
          <Card>
            <CardContent className="p-6 md:p-8 space-y-5">
              <div className="flex items-center gap-2">
                <Plus className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Add one</h2>
              </div>
              <form action={addBound} className="space-y-3">
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Country</Label>
                    <Input
                      name="country"
                      required
                      pattern="[A-Za-z]{2}"
                      maxLength={2}
                      className="font-mono uppercase tracking-widest"
                      placeholder="VN"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Postcode</Label>
                    <Input name="pattern" required placeholder="710000" className="font-mono" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Source (optional)</Label>
                  <Input name="source" placeholder="Manual entry" />
                </div>
                <div className="flex items-center justify-end">
                  <Button type="submit" variant="outline" className="gap-1.5">
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
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
