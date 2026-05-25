import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, Truck, Save } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listCarriers, createAccount } from '@/features/carrier-rates/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

async function handleSubmitAction(userId: string, formData: FormData) {
  'use server';
  const carrierId = String(formData.get('carrierId') ?? '');
  const name = String(formData.get('name') ?? '');
  const costCurrency = String(formData.get('costCurrency') ?? '').toUpperCase();
  const displayCurrency = String(formData.get('displayCurrency') ?? '').toUpperCase();
  const fxCostPerDisplay = String(formData.get('fxCostPerDisplay') ?? '');
  const notes = String(formData.get('notes') ?? '');
  const id = await createAccount({ carrierId, name, costCurrency, displayCurrency, fxCostPerDisplay, notes }, userId);
  redirect(`/f/carrier-rates/${id}`);
}

export default async function NewCarrierAccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_carrier_rates')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to create carrier accounts.</p>
      </div>
    );
  }

  const carriers = await listCarriers();
  const submitBound = handleSubmitAction.bind(null, session.user.id);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/carrier-rates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Carrier rates
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Truck className="size-3.5" />
          New carrier account
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Add a contract</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          One account per signed rate sheet. You&rsquo;ll add zones, weight tiers, and the rate matrix on the next screen.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-8">
          <form action={submitBound} className="space-y-6">
            <Field label="Carrier" hint="Pick the carrier brand. Add more brands via SQL — they don&rsquo;t need a code release.">
              <select
                name="carrierId"
                required
                className="w-full border border-input bg-input/30 rounded-lg px-3 h-9 text-sm"
                defaultValue={carriers[0]?.id ?? ''}
              >
                {carriers.length === 0 && <option value="">No carriers seeded</option>}
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Account name" hint="A label for this contract — e.g. 'DHL Express Vietnam 2026'.">
              <Input name="name" type="text" required placeholder="DHL Express Vietnam 2026" />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Cost currency" hint="What the rate sheet is priced in.">
                <Input
                  name="costCurrency"
                  type="text"
                  defaultValue="VND"
                  required
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  className="font-mono uppercase tracking-widest"
                />
              </Field>
              <Field label="Display currency" hint="What buyers see at checkout.">
                <Input
                  name="displayCurrency"
                  type="text"
                  defaultValue="USD"
                  required
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  className="font-mono uppercase tracking-widest"
                />
              </Field>
              <Field label="FX rate" hint="Cost per 1 display unit. e.g. 26000 = 1 USD = 26 000 VND.">
                <Input
                  name="fxCostPerDisplay"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  defaultValue="26000"
                  required
                  className="font-mono tabular-nums"
                />
              </Field>
            </div>

            <Field label="Notes" hint="Optional. Contract number, valid-until date, anything to remember.">
              <Input name="notes" type="text" placeholder="Contract #VN-2026-001 — expires 31 Dec 2026" />
            </Field>

            <footer className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Link href="/f/carrier-rates" className="text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
              <Button type="submit" size="lg" className="gap-2">
                <Save className="size-4" />
                Create account
              </Button>
            </footer>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
