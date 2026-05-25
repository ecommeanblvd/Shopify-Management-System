import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Coins, Upload, FileSpreadsheet } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { loadMatrix, setCell, clearCell, importMatrix } from '@/features/carrier-rates/matrix-actions';
import { parseMatrixCsv } from '@/features/carrier-rates/matrix-csv';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RateMatrix } from '@/components/carrier-rates/RateMatrix';

export const dynamic = 'force-dynamic';

async function setCellWrapper(accountId: string, userId: string, input: { zoneId: string; tierId: string; costAmount: string }) {
  'use server';
  await setCell({ ...input, userId });
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

async function clearCellWrapper(accountId: string, input: { zoneId: string; tierId: string }) {
  'use server';
  await clearCell(input);
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

async function importCsvAction(accountId: string, userId: string, formData: FormData) {
  'use server';
  const csv = String(formData.get('csv') ?? '');
  const parsed = parseMatrixCsv(csv);
  if (parsed.rows.length === 0) {
    throw new Error('CSV produced no rows. ' + (parsed.warnings.join(' · ') || ''));
  }
  await importMatrix(accountId, parsed, userId);
  revalidatePath(`/f/carrier-rates/${accountId}/matrix`);
}

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { zones, tiers, cells } = await loadMatrix(id);

  const setBound = setCellWrapper.bind(null, id, session.user.id);
  const clearBound = clearCellWrapper.bind(null, id);
  const importBound = importCsvAction.bind(null, id, session.user.id);

  const totalCells = zones.length * tiers.length;
  const filled = cells.length;
  const fillPct = totalCells === 0 ? 0 : Math.round((filled / totalCells) * 100);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Coins className="size-3.5" />
          Rate matrix
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Cost per (zone × tier)</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Inline-edit each cell to set the base cost in {account.costCurrency}. Tab/Enter commits and saves automatically; Esc cancels.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Zones" value={String(zones.length)} sub={zones.length === 0 ? 'Add some first' : 'Configured'} />
        <StatTile label="Tiers" value={String(tiers.length)} sub={tiers.length === 0 ? 'Add some first' : 'Configured'} />
        <StatTile label="Cells filled" value={`${filled}/${totalCells}`} sub={`${fillPct}% complete`} />
      </div>

      <Card>
        <CardContent className="p-0">
          <RateMatrix
            zones={zones}
            tiers={tiers}
            initialCells={cells
              .filter((c): c is typeof c & { costAmount: string } => c.costAmount !== null)
              .map((c) => ({ zoneId: c.zoneId, tierId: c.tierId, costAmount: c.costAmount }))}
            costCurrency={account.costCurrency}
            canEdit={canManage}
            setCellAction={setBound}
            clearCellAction={clearBound}
          />
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="p-6 md:p-8 space-y-5">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Bulk import CSV</h2>
              <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider ml-auto">Creates missing zones &amp; tiers</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste a rate sheet with the first column = weight tier upper-bound (kg), and the rest of the columns = zone labels. Missing cells are skipped. Existing cells are overwritten.
            </p>
            <form action={importBound} className="space-y-3">
              <Textarea
                name="csv"
                rows={10}
                className="font-mono text-xs"
                placeholder={[
                  ',Zone 1,Zone 2,Zone 3',
                  '0.5,180000,210000,260000',
                  '1.0,260000,310000,380000',
                ].join('\n')}
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
