import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { previewApply, executeApply } from '@/features/settings-sync/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const dynamic = 'force-dynamic';
type Domain = 'shipping' | 'checkout_buyer_experience';

async function runApplyAction(userId: string, formData: FormData) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  const ids = formData.getAll('storeIds').map(String);
  const d = formData.get('domain') as Domain;
  const v = Number(formData.get('version'));
  await executeApply(ids, d, v, userId);
  redirect('/f/settings-sync/history');
}

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ domain?: string; storeId?: string; version?: string }> }) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return <p>Forbidden.</p>;

  const stores = await db.select().from(schema.stores);
  const templates = await db.select().from(schema.settingTemplates).orderBy(desc(schema.settingTemplates.version));
  const domain = (sp.domain ?? 'shipping') as Domain;
  const storeId = sp.storeId ?? stores[0]?.id ?? '';
  const version = sp.version ? Number(sp.version) : templates.find((t) => t.domain === domain)?.version;

  let preview: unknown = null;
  if (storeId && version != null) {
    try { preview = await previewApply(storeId, domain, version); }
    catch (err) { preview = { error: 'Preview failed', detail: err instanceof Error ? err.message : String(err) }; }
  }

  const submitBound = runApplyAction.bind(null, session.user.id);

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold">Apply settings</h1>

      <Card>
        <CardHeader><CardTitle>1. Choose template + store</CardTitle></CardHeader>
        <CardContent>
          <form method="get" className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <select id="domain" name="domain" defaultValue={domain} className="border rounded-sm px-2 py-1 text-sm bg-[var(--color-input)] w-full">
                <option value="shipping">shipping</option>
                <option value="checkout_buyer_experience">checkout_buyer_experience</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="storeId">Store</Label>
              <select id="storeId" name="storeId" defaultValue={storeId} className="border rounded-sm px-2 py-1 text-sm bg-[var(--color-input)] w-full">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <select id="version" name="version" defaultValue={version ?? ''} className="border rounded-sm px-2 py-1 text-sm bg-[var(--color-input)] w-full">
                {templates.filter((t) => t.domain === domain).map((t) => <option key={t.id} value={t.version}>v{t.version}</option>)}
              </select>
            </div>
            <div className="col-span-3"><Button type="submit" variant="outline">Preview</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Preview diff</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs font-mono p-3 rounded-md bg-[var(--color-muted-surface)] overflow-auto max-h-96">{JSON.stringify(preview, null, 2)}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Confirm + apply</CardTitle></CardHeader>
        <CardContent>
          <form action={submitBound} className="space-y-4">
            <input type="hidden" name="domain" value={domain} />
            <input type="hidden" name="version" value={version ?? ''} />
            <div>
              <Label>Target stores</Label>
              <div className="mt-2 space-y-1">
                {stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="storeIds" value={s.id} defaultChecked={s.id === storeId} className="size-4" />
                    {s.name} <span className="text-xs font-mono text-[var(--color-muted)]">{s.shopDomain}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit">Apply to selected stores</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
