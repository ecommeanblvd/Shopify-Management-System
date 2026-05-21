import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { previewMarketsApply, executeMarketsApply } from '@/features/markets/actions';
import { ApplyModal } from '@/components/markets/ApplyModal';

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
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Apply markets to a store</h1>
      <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
    </div>
  );
}
