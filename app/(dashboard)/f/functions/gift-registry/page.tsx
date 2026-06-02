import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, Gift, Power, ExternalLink, Globe } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  listGiftRegistryStatusPerStore, setGiftRegistryEnabled,
} from '@/features/functions/gift-registry/admin-actions';
import { getCrossStoreActivity, rollupCrossStore } from '@/features/functions/cross-store';
import { GiftRegistryToggle } from '@/components/functions/GiftRegistryToggle';
import { CrossStoreActivityTable } from '@/components/functions/CrossStoreActivityTable';

export const dynamic = 'force-dynamic';

export default async function GiftRegistryAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const canManage = hasPermission(role, 'manage_functions');
  const [stores, crossStore] = await Promise.all([
    listGiftRegistryStatusPerStore(),
    getCrossStoreActivity('gift-registry'),
  ]);
  const crossRollup = rollupCrossStore(crossStore);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/functions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Functions
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Gift className="size-3.5" />
          Gift Registry
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Gift Registry</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Share-first wishlist for weddings, birthdays, baby showers. Owners
          create a registry with an event date and message; guests reserve
          items so duplicates are avoided. Public viewer at <code className="font-mono text-xs">/gr/[token]</code>.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Stores ({stores.length})
            </h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {stores.filter((s) => s.enabled).length} active
            </Badge>
          </div>
          {stores.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No Shopify stores connected yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {stores.map((s) => (
                <li key={s.storeId} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium truncate">{s.storeName}</h3>
                      {s.enabled && (
                        <Badge variant="secondary" className="h-4 text-[9px] uppercase tracking-wider gap-1 px-1.5">
                          <Power className="size-2.5 text-amber-500" />
                          active
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{s.shopDomain}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {s.enabled && (
                      <Link
                        href={`/f/functions/gift-registry/${s.storeId}`}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        Manage
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                    <GiftRegistryToggle
                      storeId={s.storeId}
                      enabled={s.enabled}
                      canManage={canManage}
                      saveAction={setGiftRegistryEnabled}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold inline-flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              Cross-store activity
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono tabular-nums">
              <span>{crossRollup.totalEvents7d.toLocaleString()} / 7d</span>
              <span className="opacity-50">·</span>
              <span>{crossRollup.totalEvents.toLocaleString()} lifetime</span>
            </div>
          </div>
          <CrossStoreActivityTable
            rows={crossStore}
            adminPathPrefix="/f/functions/gift-registry"
            accentDot="text-amber-500"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-2">
          <h3 className="text-sm font-semibold">Storefront integration</h3>
          <p className="text-xs text-muted-foreground">
            The PDP embed is live. Activate a store, open its analytics
            page, and copy the script tag to drop the &ldquo;Add to gift
            registry&rdquo; button on every product page. Shoppers can
            also start a registry directly from{' '}
            <code className="font-mono text-[11px]">/gr/new?shop=&lt;handle&gt;.myshopify.com</code>.
          </p>
          <p className="text-[11px] font-mono text-muted-foreground/80 mt-1.5">
            Bundle:{' '}
            <span className="text-foreground">/api/storefront/gift-registry/embed</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
