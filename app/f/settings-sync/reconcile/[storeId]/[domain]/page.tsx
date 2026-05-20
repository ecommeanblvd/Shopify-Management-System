import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { runQuery } from '@/lib/shopify/connector';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { settingsSyncManifest } from '@/features/settings-sync/manifest';
import { listUnreconciledPaths } from '@/features/settings-sync/reconciliation';
import { getLatestTemplate, setStoreReconciled } from '@/features/settings-sync/actions';
import { recordAudit } from '@/lib/logging/audit';
import {
  SHIPPING_QUERY,
  normalizeShopifyDeliveryProfile,
} from '@/features/settings-sync/domain/shipping';
import {
  BUYER_EXPERIENCE_QUERY,
  normalizeBuyerExperience,
} from '@/features/settings-sync/domain/checkout-buyer-experience';

export const dynamic = 'force-dynamic';

type Domain = 'shipping' | 'checkout_buyer_experience';

type StoreRow = typeof schema.stores.$inferSelect;

async function fetchCurrentTree(store: StoreRow, domain: Domain): Promise<Record<string, unknown>> {
  const storeArg = {
    id: store.id,
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    status: store.status,
    maintenanceMode: store.maintenanceMode,
    scopes: store.scopes,
  };
  const deps = {
    isEnabled: (fk: string, sid: string) => isFeatureEnabled(fk, sid),
    graphql: graphqlCall,
    decryptToken: getStoreToken,
  };

  if (domain === 'shipping') {
    const data = await runQuery({
      store: storeArg,
      featureKey: settingsSyncManifest.key,
      requiredScopes: settingsSyncManifest.requiredScopes,
      query: SHIPPING_QUERY,
      deps,
    });
    return normalizeShopifyDeliveryProfile(data).tree as unknown as Record<string, unknown>;
  }

  const data = await runQuery({
    store: storeArg,
    featureKey: settingsSyncManifest.key,
    requiredScopes: settingsSyncManifest.requiredScopes,
    query: BUYER_EXPERIENCE_QUERY,
    deps,
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

// Module-scope server actions using .bind() to pass per-request data (Task 12 pattern).

async function submitReconcile(
  storeId: string,
  domain: Domain,
  currentJson: string,
  unreconciledJson: string,
  userId: string,
  formData: FormData,
) {
  'use server';
  const current = JSON.parse(currentJson) as Record<string, unknown>;
  const unreconciled = JSON.parse(unreconciledJson) as string[];

  for (const path of unreconciled) {
    const decision = formData.get(`p:${path}`);
    if (decision === 'keep') {
      const value = getByPath(current, path);
      await db
        .insert(schema.settingOverrides)
        .values({
          storeId,
          domain,
          path,
          value: value as object,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [
            schema.settingOverrides.storeId,
            schema.settingOverrides.domain,
            schema.settingOverrides.path,
          ],
          set: { value: value as object, updatedBy: userId, updatedAt: new Date() },
        });
    }
  }
  await setStoreReconciled(storeId, domain, userId);
  await recordAudit({
    userId,
    storeId,
    featureKey: settingsSyncManifest.key,
    action: 'reconcile_store',
    target: domain,
    result: 'success',
  });
  redirect('/f/settings-sync');
}

async function markReconciled(storeId: string, domain: Domain, userId: string) {
  'use server';
  await setStoreReconciled(storeId, domain, userId);
  await recordAudit({
    userId,
    storeId,
    featureKey: settingsSyncManifest.key,
    action: 'reconcile_store',
    target: domain,
    result: 'success',
  });
  redirect('/f/settings-sync');
}

export default async function ReconcileWizard({
  params,
}: {
  params: Promise<{ storeId: string; domain: string }>;
}) {
  const { storeId, domain } = await params;
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') {
    return <p>Unknown domain.</p>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [roleRow] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.userId, session.user.id))
    .limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'reconcile_store')) return <p>Forbidden.</p>;

  const [store] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!store) return <p>Store not found.</p>;

  const template = await getLatestTemplate(domain as Domain);
  const templateTree = (template?.payload ?? {}) as Record<string, unknown>;
  const current = await fetchCurrentTree(store, domain as Domain);
  const unreconciled = listUnreconciledPaths(current, templateTree);

  // Serialize per-request data as JSON strings so they pass safely through .bind()
  // without triggering the Next.js closure-capture restriction on server actions.
  const currentJson = JSON.stringify(current);
  const unreconciledJson = JSON.stringify(unreconciled);

  const submitBound = submitReconcile.bind(
    null,
    storeId,
    domain as Domain,
    currentJson,
    unreconciledJson,
    session.user.id,
  );
  const markBound = markReconciled.bind(null, storeId, domain as Domain, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>
        Reconcile {store.shopDomain} / {domain}
      </h1>
      {unreconciled.length === 0 ? (
        <form action={markBound}>
          <p>No unreconciled paths. Click to mark as reconciled.</p>
          <button type="submit">Mark reconciled</button>
        </form>
      ) : (
        <form action={submitBound}>
          <p>
            For each setting that exists on the store but not in the template, choose what to do:
          </p>
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Keep as override</th>
                <th>Discard on next apply</th>
              </tr>
            </thead>
            <tbody>
              {unreconciled.map((p) => (
                <tr key={p}>
                  <td>
                    <code>{p}</code>
                  </td>
                  <td>
                    <input type="radio" name={`p:${p}`} value="keep" defaultChecked />
                  </td>
                  <td>
                    <input type="radio" name={`p:${p}`} value="discard" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="submit" style={{ marginTop: 12 }}>
            Save
          </button>
        </form>
      )}
    </main>
  );
}
