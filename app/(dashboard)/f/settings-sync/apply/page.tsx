import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { ChevronLeft, Play, FileCode2, GitCompare } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { previewApply, executeApply } from '@/features/settings-sync/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

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
  if (!role || !hasPermission(role, 'apply_settings')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to apply settings.</p>
      </div>
    );
  }

  const stores = await db.select().from(schema.stores);
  const templates = await db.select().from(schema.settingTemplates).orderBy(desc(schema.settingTemplates.version));
  const domain = (sp.domain ?? 'shipping') as Domain;
  const storeId = sp.storeId ?? stores[0]?.id ?? '';
  const version = sp.version ? Number(sp.version) : templates.find((t) => t.domain === domain)?.version;
  const domainTemplates = templates.filter((t) => t.domain === domain);

  let preview: unknown = null;
  if (storeId && version != null) {
    try { preview = await previewApply(storeId, domain, version); }
    catch (err) { preview = { error: 'Preview failed', detail: err instanceof Error ? err.message : String(err) }; }
  }

  const submitBound = runApplyAction.bind(null, session.user.id);

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Settings Sync
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Play className="size-3.5" />
          Apply runner
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Apply settings</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Three steps: pick the template version + a store to dry-run against, review the diff, then confirm the target list and apply.
        </p>
      </header>

      {/* Step 1 — choose */}
      <Card>
        <CardContent className="p-6 md:p-8 space-y-5">
          <Step n={1} icon={<FileCode2 className="size-4" />} title="Choose template + store" hint="The store is used only for the diff preview; you confirm the full target list at step 3." />
          <form method="get" className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FieldSelect id="domain" label="Domain" name="domain" defaultValue={domain}>
              <option value="shipping">shipping</option>
              <option value="checkout_buyer_experience">checkout_buyer_experience</option>
            </FieldSelect>
            <FieldSelect id="storeId" label="Preview against" name="storeId" defaultValue={storeId}>
              {stores.length === 0 ? <option value="">No stores</option> : stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FieldSelect>
            <FieldSelect id="version" label="Template version" name="version" defaultValue={String(version ?? '')}>
              {domainTemplates.length === 0
                ? <option value="">No versions</option>
                : domainTemplates.map((t) => <option key={t.id} value={t.version}>v{t.version}</option>)}
            </FieldSelect>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit" variant="outline" className="gap-1.5">
                <GitCompare className="size-4" />
                Refresh preview
              </Button>
              <span className="text-xs text-muted-foreground">Updates the diff below using the current selection.</span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Step 2 — preview */}
      <Card>
        <CardContent className="p-6 md:p-8 space-y-5">
          <Step n={2} icon={<GitCompare className="size-4" />} title="Preview diff" hint="Read-only JSON of what apply would do. Inspect for unexpected ops before continuing." />
          <pre className="text-xs font-mono p-4 rounded-xl bg-muted/40 border border-border overflow-auto max-h-96">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Step 3 — confirm */}
      <Card>
        <CardContent className="p-6 md:p-8 space-y-5">
          <Step n={3} icon={<Play className="size-4" />} title="Confirm + apply" hint="Apply runs against every store you tick. Each one is recorded in History." />
          <form action={submitBound} className="space-y-5">
            <input type="hidden" name="domain" value={domain} />
            <input type="hidden" name="version" value={String(version ?? '')} />
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Target stores</Label>
              {stores.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No stores connected.</div>
              ) : (
                <ul className="space-y-1.5">
                  {stores.map((s) => (
                    <li key={s.id}>
                      <label className="flex items-center gap-3 rounded-xl border border-border px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                        <input
                          type="checkbox"
                          name="storeIds"
                          value={s.id}
                          defaultChecked={s.id === storeId}
                          className="size-4 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{s.shopDomain}</div>
                        </div>
                        <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider shrink-0">
                          {s.status}
                        </Badge>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" size="lg" disabled={stores.length === 0 || version == null} className="gap-2">
              <Play className="size-4" />
              Apply to selected stores
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ n, icon, title, hint }: { n: number; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold tracking-tight flex items-center gap-1.5">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

function FieldSelect({
  id, label, name, defaultValue, children,
}: { id: string; label: string; name: string; defaultValue: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="w-full border border-input bg-input/30 rounded-lg px-3 h-9 text-sm"
      >
        {children}
      </select>
    </div>
  );
}
