import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { saveTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/markets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Markets
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          New template
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">New market</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Define a region with its countries, currencies, and languages. You&rsquo;ll add per-store overrides on the next screen.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-10">
          <MarketForm initial={EMPTY} isNew onSubmit={handleSubmit} />
        </CardContent>
      </Card>
    </div>
  );
}
