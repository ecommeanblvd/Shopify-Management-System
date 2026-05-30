import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { applySkuCosts } from '@/features/shopify-orders/csv-upload/apply-sku-costs';
import { CsvUploader, type UploadResult } from '@/components/shopify-orders/CsvUploader';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CostsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_sku_costs')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const recent = await db
    .select()
    .from(schema.skuCosts)
    .where(eq(schema.skuCosts.storeId, storeId))
    .orderBy(desc(schema.skuCosts.uploadedAt))
    .limit(50);

  async function uploadAction(form: FormData): Promise<UploadResult> {
    'use server';
    const session2 = await auth.api.getSession({ headers: await headers() });
    if (!session2) throw new Error('unauthenticated');
    const file = form.get('file') as File;
    const csvText = await file.text();
    const r = await applySkuCosts({
      storeId, csvText, filename: file.name, userId: session2.user.id,
    });
    revalidatePath(`/f/orders/${storeId}/costs`);
    return r;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/orders/${storeId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {store.name}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">SKU costs</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload CSV of cost-per-SKU. Costs are time-versioned by <span className="font-mono">effective_from</span>; orders use the latest cost effective on or before <span className="font-mono">processed_at</span>.
        </p>
      </header>

      <CsvUploader
        uploadAction={uploadAction}
        expectedHeaders={['sku', 'cost', 'currency', 'effective_from']}
        hint="effective_from is YYYY-MM-DD; blank = today."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent uploads (latest 50 rows)
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-left px-4 py-2">Cur.</th>
                  <th className="text-left px-4 py-2">Effective from</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-left px-4 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2 font-mono">{r.sku}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.costPerUnit}</td>
                    <td className="px-4 py-2 font-mono">{r.currency}</td>
                    <td className="px-4 py-2 font-mono">{r.effectiveFrom}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.source}</td>
                    <td className="px-4 py-2 text-xs">{new Date(r.uploadedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
