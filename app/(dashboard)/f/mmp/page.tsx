import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ArrowRight, Tag, Inbox, CheckCircle2, XCircle, Truck, Package, ShoppingBag, Search } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { listBrandsWithCounts, searchAllProducts } from '@/features/mmp/queries';

export const dynamic = 'force-dynamic';

const SEARCH_PAGE_SIZE = 30;

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function fmtVnd(s: string): string {
  return new Intl.NumberFormat('vi-VN').format(Number(s)) + ' ₫';
}

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function MmpProductsLanding({ searchParams }: PageProps): Promise<React.ReactNode> {
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

  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  // When search is active we run a global product lookup instead of
  // the brand-card view — the brand tally is still useful as a header,
  // but the body becomes a flat product grid.
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

  const searchResult = search
    ? await searchAllProducts({
        search,
        limit: SEARCH_PAGE_SIZE,
        offset: (page - 1) * SEARCH_PAGE_SIZE,
      })
    : null;
  const lastSearchPage = searchResult ? Math.max(1, Math.ceil(searchResult.total / SEARCH_PAGE_SIZE)) : 1;

  function urlWith(over: Record<string, string | undefined>): string {
    const u = new URLSearchParams();
    const v = { q: search, page: String(page), ...over };
    for (const [k, val] of Object.entries(v)) {
      if (val && val !== '1' && val !== '') u.set(k, val);
    }
    const qs = u.toString();
    return `/f/mmp${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
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

      {/* Global search — submits GET so the URL carries state and
          back/forward + share work without client JS. */}
      <form action="/f/mmp" className="flex items-center gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            name="q"
            defaultValue={search}
            placeholder="Search products across all brands — name, SKU, portal ID"
            className="text-sm h-10 pl-9 pr-3 rounded border border-border bg-background w-full focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'default', size: 'default' })}>
          Search
        </button>
        {search && (
          <Link href="/f/mmp" className={buttonVariants({ variant: 'outline', size: 'default' })}>
            Clear
          </Link>
        )}
      </form>

      {searchResult ? (
        <SearchResults
          search={search}
          searchResult={searchResult}
          page={page}
          lastPage={lastSearchPage}
          urlWith={urlWith}
        />
      ) : brands.length === 0 ? (
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

/** Soft fill — used in dashboard cards on the standard surface. */
const TONE_STYLES: Record<Tone, string> = {
  amber:   'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rose:    'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  sky:     'bg-sky-500/10 text-sky-700 dark:text-sky-300',
};

/** Solid fill — used for badges overlaid on product photos. The soft
 *  variant is unreadable against bright skin tones / white backdrops. */
const TONE_STYLES_SOLID: Record<Tone, string> = {
  amber:   'bg-amber-500 text-white border-transparent',
  emerald: 'bg-emerald-500 text-white border-transparent',
  rose:    'bg-rose-500 text-white border-transparent',
  sky:     'bg-sky-500 text-white border-transparent',
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

const CURATION_TONE_MAP: Record<'received' | 'approved' | 'rejected' | 'pushed', Tone> = {
  received: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  pushed:   'sky',
};

interface SearchResultsProps {
  search: string;
  searchResult: Awaited<ReturnType<typeof searchAllProducts>>;
  page: number;
  lastPage: number;
  urlWith: (over: Record<string, string | undefined>) => string;
}

function SearchResults({ search, searchResult, page, lastPage, urlWith }: SearchResultsProps): React.ReactNode {
  const { items, total } = searchResult;

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{total}</span>{' '}
        {total === 1 ? 'product' : 'products'} matching{' '}
        <code className="px-1 py-0.5 rounded bg-muted text-xs">{search}</code>
      </p>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No products match this query. Try a different name, SKU, or portal ID.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((p) => {
            const tone = CURATION_TONE_MAP[p.curationStatus];
            return (
              <Link
                key={`${p.brandSlug}-${p.portalProductId}`}
                href={`/f/mmp/${encodeURIComponent(p.brandSlug)}/${encodeURIComponent(p.portalProductId)}`}
                className="group"
              >
                <Card className="overflow-hidden h-full hover:border-foreground/30 transition-colors">
                  <div className="aspect-[2/3] bg-muted relative overflow-hidden">
                    {p.thumbnailUrl ? (
                      <Image
                        src={p.thumbnailUrl}
                        alt={p.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 20vw"
                        unoptimized
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                        <Package className="size-8" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5">
                      <Badge variant="secondary" className={`text-[10px] ${TONE_STYLES_SOLID[tone]}`}>
                        {p.curationStatus}
                      </Badge>
                      {p.shopifyProductId && (
                        <Badge variant="secondary" className={`text-[10px] gap-1 ${TONE_STYLES_SOLID.sky}`}>
                          <Truck className="size-2.5" /> Shopify
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardContent className="p-3 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 truncate">
                      <Tag className="size-2.5" />
                      {p.brandDisplayName}
                    </div>
                    <h3 className="text-sm font-medium truncate">{p.name}</h3>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{p.sku}</p>
                    <div className="flex items-baseline justify-between gap-2 pt-1">
                      <span className="text-xs font-semibold tabular-nums">{fmtVnd(p.basePrice)}</span>
                      <span className="text-[10px] text-muted-foreground">{p.variantCount} variants</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {lastPage > 1 && (
        <nav className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={urlWith({ page: String(page - 1) })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Previous
              </Link>
            )}
            {page < lastPage && (
              <Link href={urlWith({ page: String(page + 1) })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}
