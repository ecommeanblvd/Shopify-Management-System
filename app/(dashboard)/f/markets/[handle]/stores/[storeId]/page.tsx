import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Layers, Store as StoreIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, getOverride, saveOverride } from '@/features/markets/actions';
import { OverrideForm } from '@/components/markets/OverrideForm';
import { Card, CardContent } from '@/components/ui/card';
import type { MarketStoreOverride } from '@/features/markets/types';

export const dynamic = 'force-dynamic';

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
    revalidatePath(`/f/markets/${handle}/stores/${storeId}`);
    revalidatePath(`/f/markets/${handle}`);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href={`/f/markets/${handle}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Back to {market.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Layers className="size-3.5" />
          Per-store override
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          {market.name}
          <span className="text-muted-foreground"> · </span>
          {store.name}
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
          <StoreIcon className="size-3.5" />
          <span className="font-mono">{store.shopDomain}</span>
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-10">
          <OverrideForm
            market={market}
            storeId={storeId}
            storeName={store.name}
            initial={initial}
            onSubmit={handleSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
