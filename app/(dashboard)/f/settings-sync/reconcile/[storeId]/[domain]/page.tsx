import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ChevronLeft, GitMerge, Save, CheckCircle2 } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { runQuery } from '@/lib/shopify/connector';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { settingsSyncManifest } from '@/features/settings-sync/manifest';
import { listUnreconciledPaths } from '@/features/settings-sync/reconciliation';
import { getLatestTemplate, setStoreReconciled } from '@/features/settings-sync/actions';
import { SHIPPING_QUERY, normalizeShopifyDeliveryProfile } from '@/features/settings-sync/domain/shipping';
import { BUYER_EXPERIENCE_QUERY, normalizeBuyerExperience } from '@/features/settings-sync/domain/checkout-buyer-experience';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
type Domain = 'shipping' | 'checkout_buyer_experience';

async function fetchCurrentTree(store: typeof schema.stores.$inferSelect, domain: Domain) {
  if (domain === 'shipping') {
    const data = await runQuery({
      store: { id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion, status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes },
      featureKey: settingsSyncManifest.key,
      requiredScopes: settingsSyncManifest.requiredScopes,
      query: SHIPPING_QUERY,
      deps: { isEnabled: (fk, sid) => isFeatureEnabled(fk, sid), graphql: graphqlCall, decryptToken: getStoreToken },
    });
    return normalizeShopifyDeliveryProfile(data).tree;
  }
  const data = await runQuery({
    store: { id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion, status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes },
    featureKey: settingsSyncManifest.key,
    requiredScopes: settingsSyncManifest.requiredScopes,
    query: BUYER_EXPERIENCE_QUERY,
    deps: { isEnabled: (fk, sid) => isFeatureEnabled(fk, sid), graphql: graphqlCall, decryptToken: getStoreToken },
  });
  return normalizeBuyerExperience(data) as unknown as Record<string, unknown>;
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

async function submitReconcile(storeId: string, domain: Domain, currentJson: string, unreconciledJson: string, userId: string, formData: FormData) {
  'use server';
  const current = JSON.parse(currentJson) as Record<string, unknown>;
  const unreconciled = JSON.parse(unreconciledJson) as string[];
  for (const path of unreconciled) {
    const decision = formData.get(`p:${path}`);
    if (decision === 'keep') {
      const value = getByPath(current, path);
      await db.insert(schema.settingOverrides).values({ storeId, domain, path, value: value as object, updatedBy: userId })
        .onConflictDoUpdate({
          target: [schema.settingOverrides.storeId, schema.settingOverrides.domain, schema.settingOverrides.path],
          set: { value: value as object, updatedBy: userId, updatedAt: new Date() },
        });
    }
  }
  await setStoreReconciled(storeId, domain, userId);
  await recordAudit({ userId, storeId, featureKey: settingsSyncManifest.key, action: 'reconcile_store', target: domain, result: 'success' });
  redirect('/f/settings-sync');
}

async function markReconciled(storeId: string, domain: Domain, userId: string) {
  'use server';
  await setStoreReconciled(storeId, domain, userId);
  await recordAudit({ userId, storeId, featureKey: settingsSyncManifest.key, action: 'reconcile_store', target: domain, result: 'success' });
  redirect('/f/settings-sync');
}

export default async function ReconcileWizard({ params }: { params: Promise<{ storeId: string; domain: string }> }) {
  const { storeId, domain } = await params;
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
  if (!role || !hasPermission(role, 'reconcile_store')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to reconcile stores.</p>
      </div>
    );
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Store not found</h1>
      </div>
    );
  }

  const template = await getLatestTemplate(domain as Domain);
  const templateTree = (template?.payload ?? {}) as Record<string, unknown>;
  const current = await fetchCurrentTree(store, domain as Domain);
  const unreconciled = listUnreconciledPaths(current, templateTree);

  const submitBound = submitReconcile.bind(null, storeId, domain as Domain, JSON.stringify(current), JSON.stringify(unreconciled), session.user.id);
  const markBound = markReconciled.bind(null, storeId, domain as Domain, session.user.id);
  const clean = unreconciled.length === 0;

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
          <GitMerge className="size-3.5" />
          Reconcile wizard
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          {store.name}
          <span className="text-muted-foreground"> · </span>
          <span className="font-mono">{domain}</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          For every path that exists on the store but not in the template, decide whether to lock it in as a per-store override or let the next apply remove it.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-8 space-y-5">
          {clean ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 px-5 py-4 flex items-start gap-3">
                <CheckCircle2 className="size-5 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-sm">Store already matches the template</div>
                  <p className="text-sm opacity-80 mt-1">No unreconciled paths detected. You can mark this pair as reconciled without saving any overrides.</p>
                </div>
              </div>
              <form action={markBound}>
                <Button type="submit" className="gap-2">
                  <CheckCircle2 className="size-4" />
                  Mark reconciled
                </Button>
              </form>
            </div>
          ) : (
            <form action={submitBound} className="space-y-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {unreconciled.length} {unreconciled.length === 1 ? 'unreconciled path' : 'unreconciled paths'}
              </div>
              <ul className="space-y-2">
                {unreconciled.map((p) => (
                  <li key={p} className="rounded-xl border border-border px-4 py-3 space-y-3">
                    <div className="font-mono text-xs break-all">{p}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/30 cursor-pointer">
                        <input type="radio" name={`p:${p}`} value="keep" defaultChecked className="accent-primary" />
                        <div className="text-xs">
                          <div className="font-medium">Keep as override</div>
                          <div className="text-muted-foreground">Locks the current store value.</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/30 cursor-pointer">
                        <input type="radio" name={`p:${p}`} value="discard" className="accent-primary" />
                        <div className="text-xs">
                          <div className="font-medium">Discard</div>
                          <div className="text-muted-foreground">Next apply removes this path.</div>
                        </div>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                <Link href="/f/settings-sync" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
                <Button type="submit" className="gap-2">
                  <Save className="size-4" />
                  Save decisions
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
