import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { applyShippingInvoice } from '@/features/shopify-orders/csv-upload/apply-shipping-invoice';
import { type UploadResult } from '@/components/shopify-orders/CsvUploader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ShippingInvoicesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const carriers = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.enabled, true));

  const recent = await db
    .select()
    .from(schema.shippingInvoices)
    .where(eq(schema.shippingInvoices.storeId, storeId))
    .orderBy(desc(schema.shippingInvoices.uploadedAt))
    .limit(50);

  async function uploadAction(formData: FormData): Promise<UploadResult> {
    'use server';
    const file = formData.get('file') as File;
    const r = await applyShippingInvoice({
      storeId,
      carrierAccountId: String(formData.get('carrierAccountId')),
      invoicePeriodStart: String(formData.get('periodStart')),
      invoicePeriodEnd: String(formData.get('periodEnd')),
      csvText: await file.text(),
      filename: file.name,
    });
    revalidatePath(`/f/orders/${storeId}/shipping-invoices`);
    return r;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/orders/${storeId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {store.name}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Shipping invoices</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload monthly carrier invoices. Tracking numbers reconcile against existing orders;
          unmatched rows are stored anyway for late-arriving orders.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="text-xs text-muted-foreground">
            Required headers: <span className="font-mono">tracking_number, actual_cost, currency, date</span>
          </div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <form action={uploadAction as any} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Carrier</div>
                <select name="carrierAccountId" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm">
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Period start</div>
                <input type="date" name="periodStart" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
              </label>
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Period end</div>
                <input type="date" name="periodEnd" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
              </label>
            </div>
            <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
            <Button type="submit" size="sm" className="gap-1.5">
              <Upload className="size-3.5" />
              Import CSV
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent uploads (latest 50 rows)
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">Tracking #</th>
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
                    <td className="px-4 py-2 text-right font-mono">{r.actualCost}</td>
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
