import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, desc } from 'drizzle-orm';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { applyShippingInvoiceGlobal } from '@/features/shopify-orders/csv-upload/apply-shipping-invoice';
import { Card, CardContent } from '@/components/ui/card';
import {
  GlobalInvoiceUploadForm,
  type GlobalUploadResult,
} from '@/components/shopify-orders/GlobalInvoiceUploadForm';

export const dynamic = 'force-dynamic';

export default async function GlobalShippingInvoicesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const carriers = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.enabled, true));

  // Recent uploads across every store. Join in store name so the operator
  // can see where each invoice landed.
  const recent = await db
    .select({
      id: schema.shippingInvoices.id,
      trackingNumber: schema.shippingInvoices.trackingNumber,
      actualCost: schema.shippingInvoices.actualCost,
      currency: schema.shippingInvoices.currency,
      invoicePeriodStart: schema.shippingInvoices.invoicePeriodStart,
      invoicePeriodEnd: schema.shippingInvoices.invoicePeriodEnd,
      source: schema.shippingInvoices.source,
      uploadedAt: schema.shippingInvoices.uploadedAt,
      storeName: schema.stores.name,
    })
    .from(schema.shippingInvoices)
    .leftJoin(schema.stores, eq(schema.shippingInvoices.storeId, schema.stores.id))
    .orderBy(desc(schema.shippingInvoices.uploadedAt))
    .limit(50);

  async function uploadAction(formData: FormData): Promise<GlobalUploadResult> {
    'use server';
    const session2 = await auth.api.getSession({ headers: await headers() });
    if (!session2) throw new Error('unauthenticated');
    const role2 = await getRole(session2.user.id);
    if (!role2 || !hasPermission(role2, 'manage_shipping_invoices')) {
      throw new Error('forbidden');
    }
    const file = formData.get('file') as File;
    const r = await applyShippingInvoiceGlobal({
      carrierAccountId: String(formData.get('carrierAccountId')),
      invoicePeriodStart: String(formData.get('periodStart')),
      invoicePeriodEnd: String(formData.get('periodEnd')),
      csvText: await file.text(),
      filename: file.name,
    });
    revalidatePath('/f/orders/shipping-invoices');
    return r;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href="/f/orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Orders
      </Link>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Shipping invoices</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload a single carrier invoice that spans every store. Each
          <span className="font-mono"> tracking_number </span>
          is matched against synced orders and stored under the right store
          automatically. Tracking numbers not yet in the DB are reported as
          unmatched and skipped — re-upload after the next backfill or sync
          cycle.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="text-xs text-muted-foreground">
            Required headers: <span className="font-mono">tracking_number, actual_cost, currency, date</span>
          </div>
          <GlobalInvoiceUploadForm
            uploadAction={uploadAction}
            carriers={carriers.map((c) => ({ id: c.id, name: c.name }))}
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent uploads (latest 50 rows across all stores)
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">Tracking #</th>
                  <th className="text-left px-4 py-2">Store</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-left px-4 py-2">Cur.</th>
                  <th className="text-left px-4 py-2">Period</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-left px-4 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2 font-mono">{r.trackingNumber}</td>
                    <td className="px-4 py-2">{r.storeName ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{r.actualCost}</td>
                    <td className="px-4 py-2 font-mono">{r.currency}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.invoicePeriodStart} → {r.invoicePeriodEnd}</td>
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
