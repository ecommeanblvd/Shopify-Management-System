import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, Truck, Inbox, CheckCircle2, XCircle } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getProductByPortalId } from '@/features/mmp/queries';

export const dynamic = 'force-dynamic';

const CURATION_STYLES: Record<string, string> = {
  received: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  pushed:   'bg-sky-500/10 text-sky-700 dark:text-sky-300',
};
const CURATION_ICON: Record<string, React.ReactNode> = {
  received: <Inbox className="size-3" />,
  approved: <CheckCircle2 className="size-3" />,
  rejected: <XCircle className="size-3" />,
  pushed:   <Truck className="size-3" />,
};

function fmtVnd(s: string): string {
  return new Intl.NumberFormat('vi-VN').format(Number(s)) + ' ₫';
}
function fmtUsd(s: string): string {
  return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(s));
}
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

interface PageProps {
  params: Promise<{ brandSlug: string; portalProductId: string }>;
}

export default async function ProductDetailPage({ params }: PageProps): Promise<React.ReactNode> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_mmp_products')) {
    redirect('/');
  }

  const { brandSlug, portalProductId } = await params;
  const detail = await getProductByPortalId(brandSlug, portalProductId);
  if (!detail) notFound();
  const { product, variants, images } = detail;
  const canManage = hasPermission(role, 'manage_mmp_products');

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <Link
          href={`/f/mmp/${encodeURIComponent(brandSlug)}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3.5" /> {product.brandDisplayName}
        </Link>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-1 min-w-0">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{product.name}</h1>
            {product.globalName && product.globalName !== product.name && (
              <p className="text-sm text-muted-foreground">{product.globalName}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="secondary" className={`text-[10px] gap-1 ${CURATION_STYLES[product.curationStatus]}`}>
                {CURATION_ICON[product.curationStatus]}
                {product.curationStatus}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{product.status}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{product.sku}</span>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              {/* Curation actions are intentionally disabled in v1 — em sẽ
                  build server actions trong PR tiếp theo (approve/reject/
                  push-to-Shopify). UI placeholder để operator biết flow. */}
              <span
                className="text-xs px-3 py-1.5 rounded border border-dashed border-border text-muted-foreground"
                title="Coming in the next PR"
              >
                Curation actions coming soon
              </span>
            </div>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: gallery + metadata */}
        <div className="space-y-6">
          {images.length > 0 ? (
            // Horizontal carousel — cards sized so ~5 fit across the
            // left column on wide monitors, filling the available width
            // alongside the Attributes / Details cards below. When a
            // product has more images, the row scrolls horizontally
            // with snap-mandatory.
            <div
              className="
                -mx-2 px-2 overflow-x-auto snap-x snap-mandatory
                flex gap-3 pb-3
                [scrollbar-width:thin]
              "
            >
              {images.map((img) => (
                <Card
                  key={img.id}
                  className="overflow-hidden flex-none w-[220px] sm:w-[260px] lg:w-[280px] snap-start"
                >
                  <div className="aspect-[2/3] relative bg-muted">
                    <Image
                      src={img.url}
                      alt={img.altText ?? `${product.name} ${img.role ?? 'image'}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 220px, (max-width: 1024px) 260px, 280px"
                      unoptimized
                    />
                    {img.isThumbnail && (
                      <Badge variant="secondary" className="absolute top-2 left-2 text-[10px] px-2 py-0.5">
                        thumb
                      </Badge>
                    )}
                  </div>
                  <CardContent className="p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                    <span className="truncate">{img.role ?? '—'}</span>
                    <span className="font-mono shrink-0 ml-2">#{img.position}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No images attached.
              </CardContent>
            </Card>
          )}

          {product.description && (
            <Card>
              <CardContent className="p-6 space-y-2">
                <h2 className="text-sm font-semibold">Description</h2>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{product.description}</p>
              </CardContent>
            </Card>
          )}

          <MetaJson title="Attributes" data={product.attributes} />
          <MetaJson title="Details" data={product.details} />
        </div>

        {/* Right rail: key facts */}
        <aside className="space-y-3 lg:sticky lg:top-6 self-start">
          <Card>
            <CardContent className="p-4 space-y-3 text-sm">
              <KV label="Base price">
                <span className="font-semibold tabular-nums">{fmtVnd(product.basePrice)}</span>
                {product.priceUsd && (
                  <span className="text-xs text-muted-foreground ml-2">≈ {fmtUsd(product.priceUsd)}</span>
                )}
              </KV>
              <KV label="Currency">{product.currency}</KV>
              <KV label="Collection">{product.collection ?? '—'}</KV>
              <KV label="Product type">{product.productType ?? '—'}</KV>
              <Divider />
              <KV label="Portal ID"><code className="text-[10px] break-all">{product.portalProductId}</code></KV>
              <KV label="Master SKU"><code className="text-[10px]">{product.sku}</code></KV>
              <Divider />
              <KV label="Shopify product">
                {product.shopifyProductId ? (
                  <code className="text-[10px] break-all text-sky-700 dark:text-sky-300">{product.shopifyProductId}</code>
                ) : (
                  <span className="text-muted-foreground italic text-xs">not pushed yet</span>
                )}
              </KV>
              {product.pushedToShopifyAt && (
                <KV label="Pushed at" small>
                  <span className="text-xs font-mono">{fmtDate(product.pushedToShopifyAt)}</span>
                </KV>
              )}
              <Divider />
              <KV label="Last received" small>
                <span className="text-xs font-mono">{fmtDate(product.lastReceivedAt)}</span>
              </KV>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Variants ({variants.length})</h2>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-1.5 pr-2 font-medium">SKU</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Color</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Size</th>
                    <th className="text-right py-1.5 font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {variants.map((v) => (
                    <tr key={v.id} className="border-b border-border/30 last:border-b-0">
                      <td className="py-1.5 pr-2 text-[10px]">{v.sku}</td>
                      <td className="py-1.5 pr-2 text-[11px]">{v.color ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-[11px]">{v.size ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.inventory}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function KV({ label, children, small }: { label: string; children: React.ReactNode; small?: boolean }): React.ReactNode {
  return (
    <div className={`flex ${small ? 'items-center justify-between' : 'items-baseline justify-between'} gap-3 text-xs`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  );
}

function Divider(): React.ReactNode {
  return <div className="h-px bg-border/60 -mx-1" />;
}

function MetaJson({ title, data }: { title: string; data: Record<string, unknown> | null }): React.ReactNode {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 border-b border-border/30 pb-1">
              <dt className="text-muted-foreground capitalize min-w-[30%]">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd className="font-mono text-[11px] break-all flex-1">
                {typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
                  ? String(v)
                  : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
