import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingBag, Truck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function OrdersLanding() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_orders')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }

  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));

  const canManageInvoices = hasPermission(role, 'manage_shipping_invoices');

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShoppingBag className="size-3.5" />
            Orders
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Revenue dashboard</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Per-store GMV, net revenue, and margin. Time-versioned cost-of-goods and reconciled
            shipping cost.
          </p>
        </div>
        {canManageInvoices && (
          <Link href="/f/orders/shipping-invoices">
            <Button type="button" size="sm" variant="outline" className="h-9 gap-2">
              <Truck className="size-4" />
              Shipping invoices
            </Button>
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.map((s) => (
          <Link key={s.id} href={`/f/orders/${s.id}`}>
            <Card className="hover:bg-muted/30 transition-colors">
              <CardContent className="p-6">
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{s.shopDomain}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
