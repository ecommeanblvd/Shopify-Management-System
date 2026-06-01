import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ChevronLeft, Heart, Users as UsersIcon, Package, Activity, Code2 } from 'lucide-react';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getEnv } from '@/lib/env';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WishlistInstallSnippet } from '@/components/functions/WishlistInstallSnippet';
import {
  getWishlistSummary, getTopWishlistedProducts,
} from '@/features/functions/wishlist/admin-actions';
import { listWishlistsForStore } from '@/features/functions/wishlist/storefront';

export const dynamic = 'force-dynamic';

export default async function WishlistStorePage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const [summary, topProducts, wishlists] = await Promise.all([
    getWishlistSummary(storeId),
    getTopWishlistedProducts(storeId, 10),
    listWishlistsForStore(storeId, 50),
  ]);

  const embedUrl = `${getEnv().SHOPIFY_APP_URL.replace(/\/$/, '')}/api/storefront/wishlist/embed`;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/functions/wishlist"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Wishlist
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Heart className="size-3.5" />
          {store.name}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Wishlist analytics</h1>
        <p className="text-sm text-muted-foreground font-mono">{store.shopDomain}</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Tile icon={<UsersIcon className="size-4" />} label="Shoppers" value={summary.shopperCount.toLocaleString()} sub="wishlists with email" />
        <Tile icon={<Package className="size-4" />} label="Items saved" value={summary.itemCount.toLocaleString()} sub="across all wishlists" />
        <Tile icon={<Activity className="size-4" />} label="Last 7 days" value={summary.recentEvents.toLocaleString()} sub="events recorded" />
      </div>

      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Code2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Storefront install</h2>
          </div>
          <WishlistInstallSnippet shopDomain={store.shopDomain} embedUrl={embedUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Top wishlisted products</h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {topProducts.length}
            </Badge>
          </div>
          {topProducts.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No wishlist items yet. Once shoppers start saving products, the
              top-N list shows here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {topProducts.map((p, i) => (
                <li key={p.productId} className="px-5 py-3 flex items-center gap-4">
                  <span className="text-xs font-mono tabular-nums text-muted-foreground w-6 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.productTitle}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.productHandle}</div>
                  </div>
                  <span className="font-mono tabular-nums text-sm font-semibold">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Active wishlists</h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {wishlists.length}
            </Badge>
          </div>
          {wishlists.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No wishlists yet. The first shopper who adds an item gets a row here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {wishlists.map((w) => (
                <li key={w.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm truncate">{w.customerEmail ?? `device:${w.deviceId?.slice(0, 12)}…`}</div>
                  </div>
                  <span className="font-mono tabular-nums text-sm">
                    {w.itemCount} {w.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-1.5">
        <div className="text-muted-foreground text-xs uppercase tracking-wider inline-flex items-center gap-1.5">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
