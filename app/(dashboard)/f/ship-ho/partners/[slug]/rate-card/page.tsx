import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { buttonVariants } from '@/components/ui/button';
import { getPartnerRateCard } from '@/features/ship-ho/offer-ratecard-actions';
import { FEDEX_FUEL_URL } from '@/features/ship-ho/offer-ratecard-logic';
import { RateCardView } from './RateCardView';

export const dynamic = 'force-dynamic';

export default async function RateCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const r = await getPartnerRateCard(slug);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6 print:p-0 print:space-y-3">
      {/* Bản in rate card: khổ NGANG (bảng nhiều zone), lề gọn. @page chỉ áp khi
          in từ trang này — các trang khác không bị đổi hướng giấy. */}
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight print:text-xl">Rate card · {slug}</h1>
        <div className="flex items-center gap-2 print:hidden">
          <Link href={`/f/ship-ho/partners/${slug}/contracts`} className={buttonVariants({ variant: 'outline' })}>Hợp đồng</Link>
          <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>← Đối tác</Link>
        </div>
      </div>
      {!r.ok ? (
        <p className="text-red-600">{r.error}</p>
      ) : (
        <RateCardView card={r.card} partnerSlug={slug} accountName={r.accountName} fuelUrl={FEDEX_FUEL_URL} odaLookupUrl={r.odaLookupUrl} />
      )}
    </div>
  );
}
