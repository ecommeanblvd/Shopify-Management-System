import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
type Domain = 'shipping' | 'checkout_buyer_experience';

async function addOverrideAction(storeId: string, domain: Domain, userId: string, formData: FormData) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  const path = String(formData.get('path') ?? '').trim();
  const rawValue = String(formData.get('value') ?? '');
  if (!path) return;
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  await db.insert(schema.settingOverrides).values({ storeId, domain, path, value: value as object, updatedBy: userId })
    .onConflictDoUpdate({
      target: [schema.settingOverrides.storeId, schema.settingOverrides.domain, schema.settingOverrides.path],
      set: { value: value as object, updatedBy: userId, updatedAt: new Date() },
    });
}

async function removeOverrideAction(userId: string, formData: FormData) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  const id = String(formData.get('id'));
  await db.delete(schema.settingOverrides).where(eq(schema.settingOverrides.id, id));
}

export default async function OverridesPage({ params }: { params: Promise<{ id: string; domain: string }> }) {
  const { id: storeId, domain } = await params;
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') return <p>Unknown domain.</p>;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  const canEdit = role && hasPermission(role, 'apply_settings');

  const overrides = await db.select().from(schema.settingOverrides).where(and(
    eq(schema.settingOverrides.storeId, storeId),
    eq(schema.settingOverrides.domain, domain as Domain),
  ));

  const addBound = addOverrideAction.bind(null, storeId, domain as Domain, session.user.id);
  const removeBound = removeOverrideAction.bind(null, session.user.id);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Overrides</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1"><span className="font-mono">{domain}</span> for store <span className="font-mono text-xs">{storeId.slice(0, 8)}</span></p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Path</TableHead><TableHead>Value</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {overrides.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-sm text-[var(--color-muted)] text-center py-6">No overrides for this store + domain yet.</TableCell></TableRow>
              ) : overrides.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.path}</TableCell>
                  <TableCell><pre className="font-mono text-xs">{JSON.stringify(o.value)}</pre></TableCell>
                  <TableCell>{canEdit && (
                    <form action={removeBound}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="ghost" size="sm">Remove</Button>
                    </form>
                  )}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader><CardTitle>Add or update an override</CardTitle><CardDescription>Path uses dotted notation. Value is parsed as JSON; falls back to string.</CardDescription></CardHeader>
          <CardContent>
            <form action={addBound} className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-64 space-y-1">
                <label className="text-xs text-[var(--color-muted)]">Path</label>
                <Input name="path" placeholder="zones.Domestic.rates.Standard.price" />
              </div>
              <div className="flex-1 min-w-48 space-y-1">
                <label className="text-xs text-[var(--color-muted)]">Value</label>
                <Input name="value" placeholder='35000 or {"price":35000}' />
              </div>
              <Button type="submit">Add / update</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
