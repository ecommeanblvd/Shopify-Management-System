import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') return <p>Unknown domain.</p>;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'reconcile_store')) return <p>Forbidden.</p>;

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return <p>Store not found.</p>;

  const template = await getLatestTemplate(domain as Domain);
  const templateTree = (template?.payload ?? {}) as Record<string, unknown>;
  const current = await fetchCurrentTree(store, domain as Domain);
  const unreconciled = listUnreconciledPaths(current, templateTree);

  const submitBound = submitReconcile.bind(null, storeId, domain as Domain, JSON.stringify(current), JSON.stringify(unreconciled), session.user.id);
  const markBound = markReconciled.bind(null, storeId, domain as Domain, session.user.id);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Reconcile <span className="font-mono text-base">{store.shopDomain}</span></h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">Domain: <span className="font-mono">{domain}</span></p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Decide what to do with existing settings</CardTitle>
          <CardDescription>For each path that exists on the store but is not in the template, choose whether to preserve it as a per-store override or let the next apply remove it.</CardDescription>
        </CardHeader>
        <CardContent>
          {unreconciled.length === 0 ? (
            <form action={markBound} className="space-y-3">
              <p className="text-sm">No unreconciled paths — the store already matches the template.</p>
              <Button type="submit">Mark reconciled</Button>
            </form>
          ) : (
            <form action={submitBound} className="space-y-4">
              <Table>
                <TableHeader><TableRow><TableHead>Path</TableHead><TableHead>Keep as override</TableHead><TableHead>Discard on next apply</TableHead></TableRow></TableHeader>
                <TableBody>
                  {unreconciled.map((p) => (
                    <TableRow key={p}>
                      <TableCell className="font-mono text-xs">{p}</TableCell>
                      <TableCell><input type="radio" name={`p:${p}`} value="keep" defaultChecked /></TableCell>
                      <TableCell><input type="radio" name={`p:${p}`} value="discard" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button type="submit">Save</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
