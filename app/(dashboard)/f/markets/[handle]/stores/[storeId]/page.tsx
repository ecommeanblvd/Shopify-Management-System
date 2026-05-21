import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, getOverride, saveOverride } from '@/features/markets/actions';
import { OverrideForm } from '@/components/markets/OverrideForm';
import type { MarketStoreOverride } from '@/features/markets/types';

export default async function OverridePage({
  params,
}: { params: Promise<{ handle: string; storeId: string }> }) {
  const { handle, storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'apply_markets')) {
    return <div className="p-8">Forbidden</div>;
  }

  const templates = await listTemplates();
  const market = templates.find((m) => m.handle === handle);
  if (!market) notFound();

  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) notFound();

  const existing = await getOverride(storeId, handle);
  const initial: MarketStoreOverride = existing ?? {
    storeId, marketHandle: handle, priceAdjustment: null, shipping: null,
  };

  async function handleSubmit(o: MarketStoreOverride) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveOverride(o, s.user.id);
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Override</h1>
      <OverrideForm
        market={market}
        storeId={storeId}
        storeName={store.name}
        initial={initial}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
