import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getShipHoOrder } from '@/features/ship-ho/queries';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MmpOrderActions } from './MmpOrderActions';
import { TrackingCard } from './TrackingCard';

export const dynamic = 'force-dynamic';

const vnd = (v: string | null | undefined) => (v ? Number(v).toLocaleString('vi-VN') + ' ₫' : '—');

export default async function ShipHoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const o = await getShipHoOrder(id);
  if (!o) notFound();

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">{o.code}</h1>
        <div className="flex items-center gap-3">
          {o.source === 'mmp' && <MmpOrderActions orderId={o.id} />}
          <Link href="/f/ship-ho" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
        </div>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground">Đối tác</span><div>{o.partnerBrandSlug}</div></div>
        <div><span className="text-muted-foreground">Trạng thái</span><div>{o.status}</div></div>
        <div><span className="text-muted-foreground">Người nhận</span><div>{o.recipientName ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Liên hệ</span><div>{[o.recipientEmail, o.recipientPhone].filter(Boolean).join(' · ') || '—'}</div></div>
        <div><span className="text-muted-foreground">Đến</span><div>{[o.address1, o.city, o.province, o.postcode, o.country].filter(Boolean).join(', ')}</div></div>
        {o.houseNumber && <div><span className="text-muted-foreground">House Number</span><div>{o.houseNumber}</div></div>}
        {o.shortAddress && <div><span className="text-muted-foreground">Short Address</span><div>{o.shortAddress}</div></div>}
        {o.mapsUrl && <div><span className="text-muted-foreground">Google Maps</span><div><a href={o.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">{o.mapsUrl}</a></div></div>}
        <div><span className="text-muted-foreground">Cân</span><div>{o.weightKg} kg</div></div>
        <div><span className="text-muted-foreground">Carrier</span><div>{o.carrierKey ?? '—'}</div></div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Giá</div>
        <div className="flex justify-between"><span>Cước carrier (gốc)</span><span>{vnd(o.carrierCostVnd)}</span></div>
        <div className="flex justify-between"><span>Markup</span><span>{o.markupPercent ? o.markupPercent + '%' : '—'}</span></div>
        <div className="flex justify-between font-semibold border-t pt-2"><span>Giá thu partner</span><span>{vnd(o.chargedVnd)}</span></div>
        {!o.quotedAt && <p className="text-amber-600 text-xs">Chưa tính được giá — kiểm tra carrier account / rate card.</p>}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Đối soát cước</div>
        <div className="flex justify-between"><span>Cước carrier thực</span><span>{vnd(o.actualCarrierCostVnd)}</span></div>
        <div className="flex justify-between"><span>Lệch engine (thực − ước tính)</span><span>{vnd(o.deltaVnd)}</span></div>
        <div className="flex justify-between font-semibold border-t pt-2"><span>Margin (thu − thực)</span><span>{vnd(o.marginVnd)}</span></div>
        {!o.reconcileStatus && <p className="text-muted-foreground text-xs">Chưa đối soát cước thực.</p>}
      </CardContent></Card>

      <TrackingCard
        orderId={o.id}
        trackingNumber={o.trackingNumber}
        carrierKey={o.carrierKey}
        deliveryStatus={o.deliveryStatus}
        deliveredAt={o.deliveredAt}
      />
    </div>
  );
}
