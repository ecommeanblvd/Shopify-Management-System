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
  if (!role || !hasPermission(role, 'view_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const r = await getPartnerRateCard(slug);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Rate card · {slug}</h1>
        <Link href="/f/ship-ho/partners" className={buttonVariants({ variant: 'outline' })}>← Đối tác</Link>
      </div>
      {!r.ok ? (
        <p className="text-red-600">{r.error}</p>
      ) : (
        <RateCardView card={r.card} partnerSlug={slug} accountName={r.accountName} fuelUrl={FEDEX_FUEL_URL} />
      )}
    </div>
  );
}
