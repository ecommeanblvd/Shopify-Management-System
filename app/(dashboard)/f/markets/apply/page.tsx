import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, PlayCircle } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { previewMarketsApply, executeMarketsApply } from '@/features/markets/actions';
import { ApplyModal } from '@/components/markets/ApplyModal';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function ApplyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'apply_markets')) {
    return <div className="p-8">Forbidden</div>;
  }

  const stores = (await db.select().from(schema.stores))
    .map((s) => ({ id: s.id, name: s.name, shopDomain: s.shopDomain }));

  async function preview(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await previewMarketsApply(storeId);
    return { ops: r.ops };
  }

  async function apply(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await executeMarketsApply(storeId, s.user.id);
    return { errors: r.kind === 'applied' ? r.errors : [] };
  }

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-8">
      <Link
        href="/f/markets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Markets
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <PlayCircle className="size-3.5" />
          Apply runner
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Apply markets to a store</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Pick a store, dry-run to preview the GraphQL ops that will execute on Shopify, then confirm to apply. Every run is recorded in history.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-8">
          {stores.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-xl">
              <div className="text-sm font-medium">No stores connected</div>
              <div className="text-xs text-muted-foreground mt-1">Connect a store before running apply.</div>
            </div>
          ) : (
            <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
