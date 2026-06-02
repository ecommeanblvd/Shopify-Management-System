import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ChevronLeft, Gift, Layers, Activity, Calendar, Code2, ExternalLink, Download } from 'lucide-react';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getEnv } from '@/lib/env';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GiftRegistryInstallSnippet } from '@/components/functions/GiftRegistryInstallSnippet';
import {
  getGiftRegistrySummary, listRegistriesForStore,
} from '@/features/functions/gift-registry/admin-actions';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export default async function GiftRegistryStorePage({
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

  const [summary, registries] = await Promise.all([
    getGiftRegistrySummary(storeId),
    listRegistriesForStore(storeId, 50),
  ]);

  const base = getEnv().SHOPIFY_APP_URL.replace(/\/$/, '');
  const embedUrl = `${base}/api/storefront/gift-registry/embed`;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/functions/gift-registry"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Gift Registry
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Gift className="size-3.5" />
          {store.name}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Gift Registry analytics</h1>
        <p className="text-sm text-muted-foreground font-mono">{store.shopDomain}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Gift className="size-4" />} label="Registries" value={summary.registryCount.toLocaleString()} sub="all-time" />
        <Tile icon={<Layers className="size-4" />} label="Items" value={summary.itemCount.toLocaleString()} sub="across all registries" />
        <Tile icon={<Activity className="size-4" />} label="Reservations" value={summary.reservationCount.toLocaleString()} sub="excludes cancelled" />
        <Tile icon={<Calendar className="size-4" />} label="Upcoming" value={summary.upcomingCount.toLocaleString()} sub="events with a date" />
      </div>

      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Code2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Storefront install</h2>
          </div>
          <GiftRegistryInstallSnippet shopDomain={store.shopDomain} embedUrl={embedUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Active registries</h2>
            <div className="flex items-center gap-3">
              <a
                href={`/f/functions/gift-registry/${storeId}/export.csv`}
                className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Download all registries + items as CSV"
              >
                <Download className="size-3" />
                Export CSV
              </a>
              <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
                {registries.length}
              </Badge>
            </div>
          </div>
          {registries.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No registries yet. Owners create one via the public storefront form.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {registries.map((r) => (
                <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium truncate">{r.eventName}</h3>
                      <Badge variant="outline" className="h-4 text-[9px] font-mono">
                        {r.itemCount} items
                      </Badge>
                      {r.reservationCount > 0 && (
                        <Badge variant="secondary" className="h-4 text-[9px]">
                          {r.reservationCount} reserved
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {r.ownerName ? `${r.ownerName} · ` : ''}
                      <span className="font-mono">{r.ownerEmail}</span>
                      {r.eventDate && (
                        <>
                          {' · '}
                          <span>{formatDate(r.eventDate)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <a
                    href={`${base}/gr/${r.shareToken}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                  >
                    Open
                    <ExternalLink className="size-3" />
                  </a>
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
