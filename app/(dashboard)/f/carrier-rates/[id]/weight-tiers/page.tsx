import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Layers, Plus, Trash2, Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { listWeightTiers, createWeightTier, deleteWeightTier, seedDefaultTiers } from '@/features/carrier-rates/tiers-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

async function addTierAction(accountId: string, formData: FormData) {
  'use server';
  const upper = String(formData.get('upperKg') ?? '');
  await createWeightTier(accountId, upper);
  revalidatePath(`/f/carrier-rates/${accountId}/weight-tiers`);
}

async function deleteTierAction(accountId: string, tierId: string) {
  'use server';
  await deleteWeightTier(tierId);
  revalidatePath(`/f/carrier-rates/${accountId}/weight-tiers`);
}

async function seedAction(accountId: string) {
  'use server';
  await seedDefaultTiers(accountId);
  revalidatePath(`/f/carrier-rates/${accountId}/weight-tiers`);
}

export default async function WeightTiersPage({ params }: { params: Promise<{ id: string }> }) {
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
  const tiers = await listWeightTiers(id);

  const addBound = addTierAction.bind(null, id);
  const seedBound = seedAction.bind(null, id);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Layers className="size-3.5" />
          Weight tiers
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Tier breakpoints</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Each tier covers weights in the bracket <span className="font-mono">(previous, this]</span> kg. The last tier extends to infinity.
        </p>
      </header>

      {canManage && tiers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center bg-muted/20">
          <div className="size-10 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-3">
            <Sparkles className="size-5" />
          </div>
          <div className="text-sm font-medium">No tiers yet</div>
          <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
            Seed the default ladder (0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 20, 30, 50, 70, 100 kg) or add your own.
          </p>
          <form action={seedBound}>
            <Button type="submit" className="gap-2">
              <Sparkles className="size-4" />
              Seed default ladder
            </Button>
          </form>
        </div>
      )}

      {canManage && (
        <Card>
          <CardContent className="p-5 md:p-6">
            <form action={addBound} className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">New tier upper bound</Label>
                <Input
                  name="upperKg"
                  type="number"
                  required
                  step="0.001"
                  min="0.001"
                  max="1000"
                  placeholder="e.g. 5"
                  className="font-mono tabular-nums"
                />
                <p className="text-xs text-muted-foreground">Maximum weight (in kg) that this tier covers.</p>
              </div>
              <Button type="submit" className="gap-1.5">
                <Plus className="size-4" />
                Add tier
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tiers.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{tiers.length} {tiers.length === 1 ? 'tier' : 'tiers'}</h2>
              <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider font-mono">{account.weightUnit}</Badge>
            </div>
            <ul className="divide-y divide-border">
              {tiers.map((t, i) => {
                const prev = i === 0 ? 0 : Number(tiers[i - 1].upperKg);
                const upper = Number(t.upperKg);
                const isLast = i === tiers.length - 1;
                return (
                  <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-4 min-w-0">
                      <Badge variant="outline" className="h-6 px-2 font-mono tabular-nums text-xs shrink-0">
                        {i + 1}
                      </Badge>
                      <div className="min-w-0">
                        <div className="text-sm font-medium font-mono tabular-nums">
                          ({prev.toFixed(prev % 1 ? 3 : 0)} – {upper.toFixed(upper % 1 ? 3 : 0)}] kg
                        </div>
                        {isLast && (
                          <div className="text-xs text-muted-foreground">Last tier — extrapolates to ∞</div>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <form action={deleteTierAction.bind(null, id, t.id)}>
                        <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2">
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Remove tier</span>
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
