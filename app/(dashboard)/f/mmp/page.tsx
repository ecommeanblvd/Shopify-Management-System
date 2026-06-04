import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ArrowRight, Tag, Inbox, CheckCircle2, XCircle, Truck, Package, ShoppingBag } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listBrandsWithCounts } from '@/features/mmp/queries';

export const dynamic = 'force-dynamic';

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export default async function MmpProductsLanding(): Promise<React.ReactNode> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_mmp_products')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">
          You don&rsquo;t have permission to view MMP products.
        </p>
      </div>
    );
  }

  const brands = await listBrandsWithCounts();
  const totals = brands.reduce(
    (acc, b) => ({
      products: acc.products + b.totalProducts,
      received: acc.received + b.byCuration.received,
      approved: acc.approved + b.byCuration.approved,
      rejected: acc.rejected + b.byCuration.rejected,
      pushed: acc.pushed + b.byCuration.pushed,
    }),
    { products: 0, received: 0, approved: 0, rejected: 0, pushed: 0 },
  );

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShoppingBag className="size-3.5" />
          Source
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">MMP Products</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Products received from MEAN Merchant Portal, grouped by brand. Review &
          approve each one before pushing the curated catalogue to Shopify.
        </p>
      </header>

      {/* Top-line tally */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Tally icon={<Package className="size-3.5" />} label="Total" value={totals.products} />
        <Tally icon={<Inbox className="size-3.5" />} label="Received" value={totals.received} tone="amber" />
        <Tally icon={<CheckCircle2 className="size-3.5" />} label="Approved" value={totals.approved} tone="emerald" />
        <Tally icon={<XCircle className="size-3.5" />} label="Rejected" value={totals.rejected} tone="rose" />
        <Tally icon={<Truck className="size-3.5" />} label="Pushed" value={totals.pushed} tone="sky" />
      </div>

      {brands.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brands.map((b) => (
            <Link key={b.slug} href={`/f/mmp/${encodeURIComponent(b.slug)}`} className="group">
              <Card className="hover:border-foreground/30 transition-colors h-full">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Tag className="size-3" /> Brand
                      </div>
                      <h2 className="text-lg font-semibold truncate">{b.displayName}</h2>
                      <p className="text-xs text-muted-foreground font-mono truncate">{b.slug}</p>
                    </div>
                    <ArrowRight className="size-4 opacity-40 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{b.totalProducts}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.totalProducts === 1 ? 'product' : 'products'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {b.byCuration.received > 0 && (
                      <CurationPill count={b.byCuration.received} label="received" tone="amber" />
                    )}
                    {b.byCuration.approved > 0 && (
                      <CurationPill count={b.byCuration.approved} label="approved" tone="emerald" />
                    )}
                    {b.byCuration.rejected > 0 && (
                      <CurationPill count={b.byCuration.rejected} label="rejected" tone="rose" />
                    )}
                    {b.byCuration.pushed > 0 && (
                      <CurationPill count={b.byCuration.pushed} label="pushed" tone="sky" />
                    )}
                    {b.totalProducts === 0 && (
                      <span className="text-xs text-muted-foreground italic">No products yet</span>
                    )}
                  </div>

                  <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/60 flex items-center justify-between">
                    <span>Last received</span>
                    <span className="font-mono">{formatDate(b.lastSeenAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

type Tone = 'amber' | 'emerald' | 'rose' | 'sky';
const TONE_STYLES: Record<Tone, string> = {
  amber:   'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rose:    'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  sky:     'bg-sky-500/10 text-sky-700 dark:text-sky-300',
};

function Tally({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: Tone }): React.ReactNode {
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className={`text-[10px] uppercase tracking-wider flex items-center gap-1 ${tone ? TONE_STYLES[tone] : 'text-muted-foreground'} rounded px-1 py-0.5 w-fit`}>
          {icon}
          {label}
        </div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function CurationPill({ count, label, tone }: { count: number; label: string; tone: Tone }): React.ReactNode {
  return (
    <Badge variant="secondary" className={`text-[10px] gap-1 ${TONE_STYLES[tone]}`}>
      <span className="font-mono">{count}</span>
      {label}
    </Badge>
  );
}

function EmptyState(): React.ReactNode {
  return (
    <Card>
      <CardContent className="p-10 text-center space-y-3">
        <Inbox className="size-8 mx-auto text-muted-foreground" />
        <h3 className="text-lg font-semibold">No products received yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          MMP will populate this view as soon as it pushes products to{' '}
          <code className="px-1 py-0.5 rounded bg-muted text-xs">POST /api/mmp/products</code>.
          Check the ingestion audit log in the operator console for delivery status.
        </p>
      </CardContent>
    </Card>
  );
}
