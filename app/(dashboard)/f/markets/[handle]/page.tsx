import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, saveTemplate, deleteTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import type { Market } from '@/features/markets/types';

export default async function MarketDetailPage({
  params,
}: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const all = await listTemplates();
  const market = all.find((m) => m.handle === handle);
  if (!market) notFound();
  const canManage = hasPermission(role, 'manage_markets_template');

  const stores = await db.select().from(schema.stores);
  const overrides = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.marketHandle, handle));
  const overrideByStore = new Map(overrides.map((o) => [o.storeId, o] as const));

  async function handleSubmit(m: Market) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveTemplate(m, s.user.id);
  }

  async function handleDelete() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await deleteTemplate(handle);
    redirect('/f/markets');
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{market.name}</h1>
        {canManage && (
          <form action={handleDelete}>
            <button
              type="submit"
              className="text-sm text-red-600 hover:underline"
            >
              Delete market
            </button>
          </form>
        )}
      </div>

      <section>
        <h2 className="text-lg font-medium mb-4">Template</h2>
        {canManage ? (
          <MarketForm initial={market} isNew={false} onSubmit={handleSubmit} />
        ) : (
          <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">{JSON.stringify(market, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-4">Per-store overrides</h2>
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stores connected.</p>
        ) : (
          <ul className="divide-y border rounded-lg">
            {stores.map((s) => {
              const o = overrideByStore.get(s.id);
              const hasAdj = o && o.priceAdjustment;
              const zoneCount = (o?.shipping as { zones?: object } | null | undefined)?.zones
                ? Object.keys((o!.shipping as { zones: object }).zones).length
                : 0;
              return (
                <li key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {hasAdj
                        ? `${(o!.priceAdjustment as { value: number }).value}% adj`
                        : 'No price adjustment'}
                      {' · '}
                      {zoneCount} shipping {zoneCount === 1 ? 'zone' : 'zones'}
                    </div>
                  </div>
                  <Link
                    href={`/f/markets/${handle}/stores/${s.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Edit
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
