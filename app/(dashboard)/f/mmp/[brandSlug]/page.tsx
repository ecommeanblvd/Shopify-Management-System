import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Search, Package, Tag, Truck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getBrand, listProductsForBrand, type CurationFilter } from '@/features/mmp/queries';
import { setBrandStatus, type BrandStatus } from '@/features/mmp/brand-actions';
import { BrandStatusControl } from '@/components/mmp/BrandStatusControl';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

const CURATION_TABS: Array<{ key: CurationFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'received', label: 'Received' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'pushed', label: 'Pushed' },
  { key: 'archived', label: 'Archived' },
  { key: 'draft', label: 'Draft' },
];

// Filter-pill styles (text only, never over a photo).
const CURATION_PILL_STYLES: Record<CurationFilter, string> = {
  all:      'border-foreground/30',
  received: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  pushed:   'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  archived: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  draft:    'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

// Badge styles for overlays on product photos. Soft fills disappear
// against bright skin tones / white studio backdrops — use solid
// chips with white text instead.
const CURATION_BADGE_STYLES: Record<Exclude<CurationFilter, 'all'>, string> = {
  received: 'bg-amber-500 text-white border-transparent',
  approved: 'bg-emerald-500 text-white border-transparent',
  rejected: 'bg-rose-500 text-white border-transparent',
  pushed:   'bg-sky-500 text-white border-transparent',
  archived: 'bg-zinc-500 text-white border-transparent',
  draft:    'bg-slate-500 text-white border-transparent',
};

function fmtVnd(s: string): string {
  return new Intl.NumberFormat('vi-VN').format(Number(s)) + ' ₫';
}

function isCurationKey(value: string): value is CurationFilter {
  return CURATION_TABS.some((t) => t.key === value);
}

interface PageProps {
  params: Promise<{ brandSlug: string }>;
  searchParams: Promise<{ curation?: string; q?: string; page?: string }>;
}

export default async function BrandProductsPage({ params, searchParams }: PageProps): Promise<React.ReactNode> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_mmp_products')) {
    redirect('/');
  }

  const { brandSlug } = await params;
  const sp = await searchParams;
  const curation: CurationFilter = sp.curation && isCurationKey(sp.curation) ? sp.curation : 'all';
  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const brand = await getBrand(brandSlug);
  if (!brand) notFound();
  const canManage = hasPermission(role, 'manage_mmp_products');

  async function setStatusAction(status: BrandStatus) {
    'use server';
    await setBrandStatus(brandSlug, status);
    revalidatePath(`/f/mmp/${brandSlug}`);
    revalidatePath('/f/mmp');
  }

  const { items, total } = await listProductsForBrand({
    brandSlug,
    curation,
    search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function urlWith(over: Record<string, string | undefined>): string {
    const u = new URLSearchParams();
    const v = { curation, q: search, page: String(page), ...over };
    for (const [k, val] of Object.entries(v)) {
      if (val && val !== 'all' && val !== '1' && val !== '') u.set(k, val);
    }
    const qs = u.toString();
    return `/f/mmp/${encodeURIComponent(brandSlug)}${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <Link href="/f/mmp" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="size-3.5" /> All brands
        </Link>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            <Tag className="size-3" /> Brand
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">{brand.displayName}</h1>
          <span className="text-xs text-muted-foreground font-mono">{brand.slug}</span>
          <div className="ml-auto"><BrandStatusControl status={brand.status} canManage={canManage} setStatusAction={setStatusAction} /></div>
        </div>
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? 'product' : 'products'} in <span className="font-medium">{CURATION_TABS.find((t) => t.key === curation)?.label}</span>
          {search ? <> matching <code className="px-1 py-0.5 rounded bg-muted text-xs">{search}</code></> : null}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {/* Curation filter pills */}
        <nav className="flex flex-wrap gap-1.5">
          {CURATION_TABS.map((t) => (
            <Link
              key={t.key}
              href={urlWith({ curation: t.key, page: '1' })}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                t.key === curation
                  ? `border-transparent ${CURATION_PILL_STYLES[t.key]}`
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {/* Search box (form GET) */}
        <form action={`/f/mmp/${encodeURIComponent(brandSlug)}`} className="ml-auto flex items-center gap-2">
          {curation !== 'all' && <input type="hidden" name="curation" value={curation} />}
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search SKU, name, portal id"
              className="text-xs h-8 pl-7 pr-3 rounded border border-border bg-background w-64"
            />
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No products match this filter.
          </CardContent>
        </Card>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((p) => (
            <Link
              key={p.portalProductId}
              href={`/f/mmp/${encodeURIComponent(brandSlug)}/${encodeURIComponent(p.portalProductId)}`}
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
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-medium shadow-sm ${CURATION_BADGE_STYLES[p.curationStatus]}`}
                    >
                      {p.curationStatus}
                    </Badge>
                    {p.shopifyProductId && (
                      <Badge
                        variant="secondary"
                        className={`text-[10px] gap-1 font-medium shadow-sm ${CURATION_BADGE_STYLES.pushed}`}
                      >
                        <Truck className="size-2.5" /> Shopify
                      </Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-3 space-y-1">
                  <h3 className="text-sm font-medium truncate">{p.name}</h3>
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{p.sku}</p>
                  <div className="flex items-baseline justify-between gap-2 pt-1">
                    <span className="text-xs font-semibold tabular-nums">{fmtVnd(p.basePrice)}</span>
                    <span className="text-[10px] text-muted-foreground">{p.variantCount} variants</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {/* Pagination */}
      {lastPage > 1 && (
        <nav className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={urlWith({ page: String(page - 1) })}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            {page < lastPage && (
              <Link
                href={urlWith({ page: String(page + 1) })}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
