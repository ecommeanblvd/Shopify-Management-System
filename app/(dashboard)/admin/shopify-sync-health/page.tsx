import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { registerOrderWebhooks } from '@/features/shopify-orders/webhook/register-subscriptions';
import { startBackfill } from '@/features/shopify-orders/backfill/actions';
import { getStoreToken } from '@/lib/shopify/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AutoRefresh } from './AutoRefresh';
import { BackfillCell } from './BackfillCell';

export const dynamic = 'force-dynamic';

export default async function SyncHealth() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_stores')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const stores = await db
    .select({
      id: schema.stores.id,
      name: schema.stores.name,
      shopDomain: schema.stores.shopDomain,
      apiVersion: schema.stores.apiVersion,
      state: schema.shopifySyncState,
    })
    .from(schema.stores)
    .leftJoin(schema.shopifySyncState, eq(schema.shopifySyncState.storeId, schema.stores.id))
    .where(eq(schema.stores.status, 'active'));

  const webhookCountsRes = await db.execute<{ store_id: string; ok: string; failed: string }>(sql`
    SELECT store_id,
           SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END)::text AS ok,
           SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END)::text AS failed
      FROM shopify_webhook_log
     WHERE received_at > NOW() - INTERVAL '24 hours'
     GROUP BY store_id;
  `);
  // db.execute returns pg's QueryResult — the rows live under `.rows`,
  // not the top-level object. Casting it as an array directly silently
  // breaks `.map`/`.length` calls (b.map is not a function in production).
  const webhookCounts = webhookCountsRes.rows;
  const wcMap = new Map(webhookCounts.map((w) => [w.store_id, w]));

  // Drive the auto-refresh only while at least one backfill is in flight.
  const anyRunning = stores.some((s) => s.state?.backfillStatus === 'running');

  async function backfillTriggerAction(formData: FormData): Promise<void> {
    'use server';
    const storeId = String(formData.get('storeId'));
    await startBackfill(storeId);
  }

  async function reregisterAction(formData: FormData): Promise<void> {
    'use server';
    const session2 = await auth.api.getSession({ headers: await headers() });
    if (!session2) throw new Error('unauthenticated');
    const role2 = await getRole(session2.user.id);
    if (!role2 || !hasPermission(role2, 'manage_stores')) throw new Error('forbidden');

    const storeId = String(formData.get('storeId'));
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (store) {
      const token = await getStoreToken(store.id);
      await registerOrderWebhooks({
        shopDomain: store.shopDomain,
        accessToken: token,
        apiVersion: store.apiVersion,
      });
    }
    revalidatePath('/admin/shopify-sync-health');
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Shopify sync health</h1>
        <AutoRefresh active={anyRunning} />
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-2">Store</th>
                <th className="text-left px-4 py-2">Backfill</th>
                <th className="text-left px-4 py-2">Last webhook</th>
                <th className="text-left px-4 py-2">Last cron</th>
                <th className="text-right px-4 py-2">Webhooks 24h (ok / failed)</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const wc = wcMap.get(s.id);
                const ago = (d: Date | null | undefined) =>
                  d ? `${Math.round((Date.now() - new Date(d).getTime()) / 60000)} min ago` : '—';
                return (
                  <tr key={s.id} className="border-b border-border/40">
                    <td className="px-4 py-2">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{s.shopDomain}</div>
                    </td>
                    <td className="px-4 py-2">
                      <BackfillCell
                        status={s.state?.backfillStatus ?? 'idle'}
                        phase={s.state?.backfillPhase ?? null}
                        objectCount={s.state?.backfillObjectCount ?? null}
                        total={s.state?.backfillTotal ?? null}
                        ingested={s.state?.backfillIngested ?? null}
                        progressAt={s.state?.backfillProgressAt ?? null}
                        error={s.state?.backfillError ?? null}
                      />
                    </td>
                    <td className="px-4 py-2">{ago(s.state?.lastWebhookAt)}</td>
                    <td className="px-4 py-2">{ago(s.state?.lastCronSyncAt)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {wc?.ok ?? '0'} / <span className="text-destructive">{wc?.failed ?? '0'}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <form action={backfillTriggerAction}>
                          <input type="hidden" name="storeId" value={s.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={s.state?.backfillStatus === 'running'}
                            title="Pull the store's full order history via Shopify bulkOperation, skipping orders already synced"
                          >
                            {s.state?.backfillStatus === 'running' ? 'Backfilling…' : 'Backfill all'}
                          </Button>
                        </form>
                        <form action={reregisterAction}>
                          <input type="hidden" name="storeId" value={s.id} />
                          <Button type="submit" size="sm" variant="outline">Re-register</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
