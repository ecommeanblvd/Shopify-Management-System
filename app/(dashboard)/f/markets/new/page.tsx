import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { saveTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import type { Market } from '@/features/markets/types';

const EMPTY: Market = {
  handle: '', name: '', type: 'regional',
  countries: [], primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [], enabled: true,
};

export default async function NewMarketPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_markets_template')) {
    return <div className="p-8">Forbidden</div>;
  }

  async function handleSubmit(m: Market) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveTemplate(m, s.user.id);
    redirect(`/f/markets/${m.handle}`);
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New market</h1>
      <MarketForm initial={EMPTY} isNew onSubmit={handleSubmit} />
    </div>
  );
}
