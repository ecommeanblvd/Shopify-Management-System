import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { ChevronLeft, Layers, Plus, Trash2, Code } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Unknown domain</h1>
      </div>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  const canEdit = !!role && hasPermission(role, 'apply_settings');

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);

  const overrides = await db.select().from(schema.settingOverrides).where(and(
    eq(schema.settingOverrides.storeId, storeId),
    eq(schema.settingOverrides.domain, domain as Domain),
  ));

  const addBound = addOverrideAction.bind(null, storeId, domain as Domain, session.user.id);
  const removeBound = removeOverrideAction.bind(null, session.user.id);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Settings Sync
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Layers className="size-3.5" />
          Per-store overrides
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          {store?.name ?? storeId.slice(0, 8)}
          <span className="text-muted-foreground"> · </span>
          <span className="font-mono">{domain}</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Overrides are leaf-level patches applied on top of the template for this single store. Use dotted paths; values are parsed as JSON, falling back to string.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Code className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{overrides.length} {overrides.length === 1 ? 'override' : 'overrides'}</h2>
            </div>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {domain}
            </Badge>
          </div>
          {overrides.length === 0 ? (
            <div className="text-center py-12 px-5">
              <Layers className="size-8 mx-auto text-muted-foreground mb-3" />
              <div className="text-sm font-medium">No overrides yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                {canEdit ? 'Add the first one below.' : 'This store inherits everything from the template.'}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {overrides.map((o) => (
                <li key={o.id} className="px-5 py-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="font-mono text-xs break-all">{o.path}</div>
                    <pre className="font-mono text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2 overflow-auto max-h-32">
                      {JSON.stringify(o.value, null, 2)}
                    </pre>
                  </div>
                  {canEdit && (
                    <form action={removeBound}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2">
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardContent className="p-6 md:p-8 space-y-5">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Add or update override</h2>
            </div>
            <form action={addBound} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="path" className="text-xs uppercase tracking-wider text-muted-foreground">Path</Label>
                  <Input id="path" name="path" placeholder="zones.Domestic.rates.Standard.price" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value" className="text-xs uppercase tracking-wider text-muted-foreground">Value</Label>
                  <Input id="value" name="value" placeholder='35000 or {"price":35000}' className="font-mono text-xs" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Path uses dot notation. Value is JSON-parsed first; otherwise stored as a string. Existing paths are upserted in place.
              </p>
              <div className="pt-3 border-t border-border flex items-center justify-end">
                <Button type="submit" className="gap-2">
                  <Plus className="size-4" />
                  Add / update
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
